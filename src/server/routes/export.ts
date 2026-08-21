import { Hono } from 'hono';
import { loadCards, loadDictionary, loadExportLog } from '../../library/files.js';
import { planExport, readExport, runExport, undoExport } from '../../library/export.js';
import { clearSession, loadSession, saveSession, requireVersion } from '../session.js';

export const exports = new Hono();

const today = () => new Date().toISOString().slice(0, 10);

/**
 * Состояние выгрузки: что уже записано и сколько ещё ждёт.
 *
 * `files` непусто — выгрузка этого прохода уже прошла, экран показывает её.
 * Пусто, а `pending` больше нуля — экран её запустит. Оба нуля — выгружать
 * нечего.
 */
exports.get('/', (c) => {
  const s = loadSession();
  const { ready, skipped } = planExport(loadCards(), s.deselected);

  return c.json({
    files: readExport(s.exported),
    pending: ready.speak.length + ready.read.length,
    skipped,
    /** прошлые выгрузки: видно, что файлы копятся, а не заменяются */
    history: loadExportLog().slice(-6).reverse(),
  });
});

/**
 * Выгрузка. Слова становятся `accepted`, файлы ложатся в user/exports/.
 *
 * Идёт сама при заходе на шаг: решение уже принято на отборе и на карточках,
 * а показывать кнопку «теперь точно» — заставлять подтверждать дважды.
 * Обратный ход даёт отмена, и он честный: откатывается ровно это действие.
 */
exports.post('/', async (c) => {
  const body = await c.req.json<{ version?: number }>().catch(() => ({}) as { version?: number });
  const s = requireVersion(body.version);

  const plan = planExport(loadCards(), s.deselected);
  if (!plan.ready.speak.length && !plan.ready.read.length) {
    return c.json({ error: 'Нечего выгружать' }, 400);
  }

  const dict = loadDictionary();
  const { files, skipped } = runExport(plan, dict, today());

  // Пути запоминаются до очистки черновика: по ним работает отмена.
  const next = saveSession({
    ...s,
    exported: files.map((f) => f.file),
    decisions: {},
    deselected: [],
    job: null,
  });

  return c.json({ files: readExport(next.exported), skipped, session: next });
});

/**
 * Отмена. Файлы удаляются, журнал забывает о них, словам возвращается
 * `proposed`. Карточки остаются — отменяется выгрузка, а не работа до неё.
 *
 * Проход после этого начинается заново с первого шага: возвращаться
 * к карточкам, которые никуда не уехали, незачем.
 */
exports.post('/undo', (c) => {
  const s = loadSession();
  if (!s.exported.length) return c.json({ error: 'Отменять нечего' }, 400);

  const undone = undoExport(s.exported, loadDictionary());
  clearSession();
  return c.json({ undone, session: loadSession() });
});
