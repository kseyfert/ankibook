import { Hono } from 'hono';
import { loadDictionary, saveDictionary } from '../../library/files.js';
import { applyDecisions } from '../../library/decisions.js';
import { saveSession, requireVersion } from '../session.js';

export const decisions = new Hono();

/**
 * Черновик решений → словарь. Момент перехода с шага 4 на шаг 5.
 *
 * Берём решения из сессии, а не из тела запроса: клиент их туда уже сохранил,
 * и второй источник тех же данных означал бы расхождение при переоткрытии
 * вкладки. Сами решения в сессии остаются — по ним делается откат при сбросе.
 */
decisions.post('/apply', async (c) => {
  const body = await c.req.json<{ version?: number }>().catch(() => ({}) as { version?: number });
  const s = requireVersion(body.version);

  const dict = loadDictionary();
  const applied = applyDecisions(dict, s.decisions);
  saveDictionary(dict);

  const counts = { speak: 0, read: 0, known: 0, rejected: 0 };
  for (const choice of Object.values(s.decisions)) counts[choice]++;

  // job обнуляется: шаг карточек отличает «ещё не запускали» от «уже был
  // прогон» именно по нему, и хвост прошлого прохода сбил бы это различие.
  return c.json({ applied, counts, session: saveSession({ ...s, step: 5, job: null }) });
});
