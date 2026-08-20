import { Hono } from 'hono';
import { bookExists, loadDictionary, saveDictionary } from '../../library/files.js';
import { revertDecisions, type Decision } from '../../library/decisions.js';
import { loadSession, saveSession, clearSession, requireVersion, type Session } from '../session.js';

export const session = new Hono();

/** Чтение версию НЕ проверяет: вторая вкладка должна видеть состояние. */
session.get('/', (c) => c.json(loadSession()));

/** Переход на шаг. */
session.post('/step', async (c) => {
  const body = await c.req.json<{ step: number; version?: number }>();
  const s = requireVersion(body.version);
  const step = Math.min(6, Math.max(1, Math.round(body.step))) as Session['step'];
  return c.json(saveSession({ ...s, step }));
});

/**
 * Выбор уже разобранной книги — «добрать слова» с шага 1.
 *
 * Разбор пропускается, поэтому сразу на отбор. Решения прошлого прохода
 * обнуляются: они относились к другой книге.
 */
session.post('/book', async (c) => {
  const body = await c.req.json<{ hash: string; version?: number }>();
  if (!bookExists(body.hash)) return c.json({ error: 'Книга не найдена' }, 404);
  const s = requireVersion(body.version);
  return c.json(
    saveSession({ ...s, bookHash: body.hash, step: 4, decisions: {}, deselected: [] }),
  );
});

/**
 * Автосохранение решений шага 4. В словарь НЕ пишет — это черновик прохода.
 *
 * Карта присылается целиком, а не патчем: снятое решение выражается
 * отсутствием ключа, и патч не смог бы его передать.
 */
session.post('/decisions', async (c) => {
  const body = await c.req.json<{ decisions: Record<string, Decision>; version?: number }>();
  const s = requireVersion(body.version);
  return c.json(saveSession({ ...s, decisions: body.decisions ?? {} }));
});

/**
 * Сброс: книга остаётся разобранной, выбор колод отбрасывается.
 *
 * Если решения уже применены к словарю (шаг 4 → 5), откатываем их в `new`.
 * Иначе «Начать заново» оставило бы слова в очереди на генерацию, хотя
 * пользователь от прохода отказался. Уже выгруженное не трогаем.
 */
session.delete('/', (c) => {
  const s = loadSession();
  if (Object.keys(s.decisions).length) {
    const dict = loadDictionary();
    if (revertDecisions(dict, s.decisions)) saveDictionary(dict);
  }
  clearSession();
  return c.json(loadSession());
});
