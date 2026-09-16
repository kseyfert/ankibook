import type { Card, Deck, DictEntry, ExportLogEntry } from './types.js';
import {
  appendExportLog, loadExportLog, readExportCsv, removeExportCsv,
  saveDictionary, saveExportLog, writeExportCsv,
} from './files.js';

const DECKS: Deck[] = ['speak', 'read'];

const key = (lemma: string, deck: Deck) => `${lemma}:${deck}`;

/** Экранирование по RFC 4180: кавычки удваиваются, поле берётся в кавычки. */
const csvField = (s: string) => `"${s.replace(/"/g, '""')}"`;

/**
 * Что уже уехало в Noji — по журналу, а не по статусам слов.
 *
 * Статус стоит на слове, а карточек у слова может быть несколько: у `endure`
 * их две, по значению на каждое. Журнал помнит поимённо.
 */
export function exportedKeys(): Set<string> {
  const out = new Set<string>();
  for (const e of loadExportLog()) {
    for (const lemma of e.lemmas) out.add(key(lemma, e.deck));
  }
  return out;
}

/**
 * Замечания сняты человеком?
 *
 * Сравниваем списки целиком: одобрение относится к тем замечаниям, которые
 * человек видел. Стоит карточке измениться — правкой или перегенерацией —
 * валидатор выдаёт другой список, совпадение пропадает, и брак снова
 * не поедет. Сбрасывать одобрение отдельным шагом не нужно, а значит
 * и забыть этот шаг негде.
 */
export function isApproved(card: Card): boolean {
  if (!card.problems.length) return true;
  const ok = card.approved ?? [];
  return ok.length === card.problems.length && card.problems.every((p) => ok.includes(p));
}

export interface ExportPlan {
  ready: Record<Deck, Card[]>;
  /** сколько и почему не поедет */
  skipped: { flagged: number; deselected: number; already: number };
}

/**
 * Что уйдёт в файлы. Ничего не пишет — нужен, чтобы показать это до нажатия.
 *
 * Карточка с замечаниями не выгружается сама: из Noji её нельзя ни
 * исправить, ни удалить, поэтому по умолчанию брак не выпускаем. Снять
 * замечание может только человек и только руками — см. `isApproved`.
 */
export function planExport(cards: Card[], deselected: string[] = []): ExportPlan {
  const done = exportedKeys();
  const off = new Set(deselected);
  const ready: Record<Deck, Card[]> = { speak: [], read: [] };
  const skipped = { flagged: 0, deselected: 0, already: 0 };

  for (const card of cards) {
    if (done.has(key(card.lemma, card.deck))) { skipped.already++; continue; }
    if (!isApproved(card)) { skipped.flagged++; continue; }
    if (off.has(card.id)) { skipped.deselected++; continue; }
    ready[card.deck].push(card);
  }

  return { ready, skipped };
}

export interface ExportResult {
  files: ExportLogEntry[];
  skipped: ExportPlan['skipped'];
}

/**
 * Пишет файлы и помечает слова выгруженными.
 *
 * ПОРЯДОК ВАЖЕН: сначала журнал, потом статусы. Упадём между ними —
 * останется запись без accepted, и слово просто выгрузится повторно.
 * Обратный порядок дал бы accepted без файла, то есть слово молча
 * пропало бы навсегда.
 */
export function runExport(
  plan: ExportPlan,
  dict: Map<string, DictEntry>,
  date: string,
): ExportResult {
  const files: ExportLogEntry[] = [];

  for (const deck of DECKS) {
    const cards = plan.ready[deck];
    if (!cards.length) continue;

    const body = cards.map((c) => `${csvField(c.front)},${csvField(c.back)}`).join('\n') + '\n';
    const file = writeExportCsv(date, deck, body);
    const lemmas = [...new Set(cards.map((c) => c.lemma))];

    const entry: ExportLogEntry = { date, deck, file, count: cards.length, lemmas };
    appendExportLog(entry);
    files.push(entry);

    for (const lemma of lemmas) {
      const d = dict.get(lemma);
      if (d) d[deck] = 'accepted';
    }
  }

  if (files.length) saveDictionary(dict);

  return { files, skipped: plan.skipped };
}

/** Файл выгрузки вместе с содержимым — чтобы показать его на экране. */
export interface ExportFile extends ExportLogEntry {
  csv: string;
}

/** Читает записанные файлы обратно. Заодно проверяет, что они на месте. */
export function readExport(files: string[]): ExportFile[] {
  const byPath = new Map(loadExportLog().map((e) => [e.file, e]));
  return files
    .map((file) => byPath.get(file))
    .filter((e): e is ExportLogEntry => e !== undefined)
    .map((e) => ({ ...e, csv: readExportCsv(e.file) }));
}

/**
 * Отмена выгрузки: файлы удаляются, записи журнала выбрасываются,
 * словам возвращается `proposed`.
 *
 * Карточки при этом остаются — за них заплачено, и переделывать их незачем.
 * Отменяется именно выгрузка, а не работа перед ней.
 *
 * ПОРЯДОК ОБРАТНЫЙ записи: сначала статусы, потом журнал, потом файлы.
 * Упадём посередине — останется запись журнала на слово со статусом
 * `proposed`, и повторная выгрузка его пропустит как уже уехавшее. Это
 * заметно и чинится вручную; обратный порядок дал бы `accepted` без записи
 * в журнале, то есть слово, о котором система забыла, что оно уехало.
 */
export function undoExport(files: string[], dict: Map<string, DictEntry>): number {
  const drop = new Set(files);
  const log = loadExportLog();
  const removed = log.filter((e) => drop.has(e.file));
  if (!removed.length) return 0;

  for (const entry of removed) {
    for (const lemma of entry.lemmas) {
      const d = dict.get(lemma);
      // Только `accepted`: слово могли успеть тронуть иначе, и затирать
      // чужое решение отмена не должна.
      if (d?.[entry.deck] === 'accepted') d[entry.deck] = 'proposed';
    }
  }
  saveDictionary(dict);

  saveExportLog(log.filter((e) => !drop.has(e.file)));
  for (const entry of removed) removeExportCsv(entry.file);

  return removed.length;
}
