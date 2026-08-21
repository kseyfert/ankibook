import { Hono } from 'hono';
import { loadCards, loadDictionary, saveCards } from '../../library/files.js';
import { regenerateCard } from '../../cards/generate.js';
import { editCard } from '../../cards/edit.js';
import { llmIfConfigured } from '../../llm/index.js';
import type { Card } from '../../library/types.js';
import { tuning } from '../../config/index.js';
import { cancelGeneration, isRunning, pending, startGeneration, JobBusy } from '../jobs.js';
import { loadSession, saveSession, requireVersion } from '../session.js';

export const cards = new Hono();

/** Сколько слов ждёт генерации и сколько карточек уже есть. */
cards.get('/pending', (c) => {
  const p = pending();
  return c.json({
    ...p,
    running: isRunning(),
    defaultLimit: tuning.generation.defaultLimit,
    autoStart: tuning.generation.autoStart,
  });
});

/**
 * Запуск прогона. Возвращается сразу, не дожидаясь модели: прогресс
 * приезжает в сессии, её и опрашивает клиент.
 */
cards.post('/generate', async (c) => {
  const body = await c.req.json<{ limit?: number }>().catch(() => ({}) as { limit?: number });
  const limit = Math.max(1, Math.min(200, Math.round(body.limit ?? tuning.generation.defaultLimit)));

  try {
    return c.json({ job: startGeneration(limit) });
  } catch (e) {
    // Занято — это не поломка, а состояние: вторая вкладка нажала первой.
    return c.json({ error: (e as Error).message }, e instanceof JobBusy ? 409 : 400);
  }
});

/** Остановить прогон. Сделанное остаётся, остальные слова — обратно в очередь. */
cards.post('/cancel', (c) => c.json({ job: cancelGeneration() }));

/**
 * Карточка для показа.
 *
 * `answer` наружу не отдаём: в CSV он не идёт и человеку на экране не нужен,
 * а на лицевой стороне cloze он же и есть ответ на пропуск.
 */
const view = (card: Card, deselected: string[]) => ({
  id: card.id,
  lemma: card.lemma,
  deck: card.deck,
  sense: card.sense,
  front: card.front,
  back: card.back,
  problems: card.problems,
  /** снятые галочкой в экспорт не пойдут */
  selected: !deselected.includes(card.id),
});

/** Карточки на проверку — те, что ещё не выгружены. */
cards.get('/', (c) => {
  const s = loadSession();
  const dict = loadDictionary();

  const all = loadCards();

  const list = all
    // Только ждущие экспорта. Выгруженную карточку показывать нечего:
    // из Noji её не исправить и не удалить, и галочка рядом с ней
    // предлагала бы то, чего сделать нельзя.
    .filter((card) => dict.get(card.lemma)?.[card.deck] === 'proposed')
    .map((card) => view(card, s.deselected));

  return c.json({
    cards: list,
    clean: list.filter((x) => x.problems.length === 0).length,
    flagged: list.filter((x) => x.problems.length > 0).length,
    // Чтобы «готово 2» при дюжине карточек в файле не читалось как потеря.
    exported: all.filter((card) => dict.get(card.lemma)?.[card.deck] === 'accepted').length,
  });
});

/**
 * Карточка, которую ещё можно менять.
 *
 * Выгруженную не трогаем: из Noji её не исправить и не удалить, и правка
 * в файле разошлась бы с тем, что человек уже повторяет.
 */
function editable(id: string): { cards: Card[]; index: number; pos: string } {
  const cards = loadCards();
  const index = cards.findIndex((c) => c.id === id);
  if (index === -1) throw new NotFound('Карточка не найдена');

  const card = cards[index];
  const entry = loadDictionary().get(card.lemma);
  if (entry?.[card.deck] !== 'proposed') {
    throw new NotFound('Карточка уже выгружена, менять её нельзя');
  }
  return { cards, index, pos: entry.pos };
}

class NotFound extends Error {}

const fail = (e: unknown) => ({ error: (e as Error).message });

/** Сделать карточку заново: то же слово и значение, другое исполнение. */
cards.post('/:id/regenerate', async (c) => {
  try {
    const { cards: all, index, pos } = editable(c.req.param('id'));
    const llm = llmIfConfigured();
    if (!llm) return c.json({ error: 'Нужен ANTHROPIC_API_KEY в окружении сервера' }, 400);

    all[index] = await regenerateCard(llm, all[index], pos);
    saveCards(all);
    return c.json({ card: view(all[index], loadSession().deselected) });
  } catch (e) {
    return c.json(fail(e), e instanceof NotFound ? 404 : 400);
  }
});

/** Правка руками. Меняется одна сторона за раз, проверки прогоняются заново. */
cards.patch('/:id', async (c) => {
  const body = await c.req.json<{ front?: string; back?: string }>().catch(() => ({}));
  try {
    const { cards: all, index } = editable(c.req.param('id'));
    all[index] = editCard(all[index], body);
    saveCards(all);
    return c.json({ card: view(all[index], loadSession().deselected) });
  } catch (e) {
    return c.json(fail(e), e instanceof NotFound ? 404 : 400);
  }
});

/** Какие карточки не брать в экспорт. Черновик прохода, как и решения. */
cards.post('/deselect', async (c) => {
  const body = await c.req.json<{ deselected: string[]; version?: number }>();
  const s = requireVersion(body.version);
  return c.json(saveSession({ ...s, deselected: body.deselected ?? [] }));
});
