import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { listBooks, loadDictionary, saveDictionary, dictPath, USER_DIR } from './files.js';
import { SKIP_POS } from './pos.js';
import type { DictEntry, Profile } from './types.js';
import { zipf } from './freq.js';

export const NEXT_PATH = join(USER_DIR, 'dictionary.next.jsonl');

export interface RebuildDiff {
  books: number;
  total: number;
  added: string[];
  /** лемма → было/стало число книг */
  bookCountUp: Array<{ lemma: string; from: number; to: number }>;
  /** статус выставлен, но источников больше нет — книга удалена */
  orphaned: string[];
  /** ниже knownZipf, статус new — потенциальные кандидаты */
  candidates: number;
}

/**
 * Словарь ПЕРЕСОБИРАЕТСЯ с нуля, а не патчится.
 *
 * Источник истины — файлы в books/. Из старого словаря переносятся только
 * твои решения (speak/read). Всё остальное производное, поэтому отмена
 * добавления книги сводится к удалению её файла и повторной сборке.
 *
 * Строки НИКОГДА не удаляются: слово могло уехать в Noji, откуда карточку
 * не забрать. Потеряв статус, мы предложили бы его заново.
 */
export function rebuild(profile: Profile): { entries: Map<string, DictEntry>; diff: RebuildDiff } {
  const books = listBooks();
  const prev = loadDictionary();
  const next = new Map<string, DictEntry>();

  for (const book of books) {
    for (const e of book.entries) {
      const z = zipf(e.lemma);
      // Служебный каркас языка — the, and, of. Не понадобится никогда.
      if (z > profile.recordZipf) continue;
      // Имена собственные, междометия, неопознанное.
      if (SKIP_POS.has(e.pos)) continue;
      // Двухбуквенные — служебные слова и артефакты вроде «o» из «O Spring!».
      if (e.lemma.length < 3) continue;

      let d = next.get(e.lemma);
      if (!d) {
        const old = prev.get(e.lemma);
        d = {
          lemma: e.lemma,
          pos: e.pos,
          zipf: z,
          totalCount: 0,
          bookCount: 0,
          books: {},
          speak: old?.speak ?? 'new',
          read: old?.read ?? 'new',
        };
        next.set(e.lemma, d);
      }
      d.books[book.hash] = e.occurrences.length;
      d.totalCount += e.occurrences.length;
      d.bookCount += 1;
      // доминирующий POS — из книги, где слово встретилось чаще
      if (e.occurrences.length >= Math.max(...Object.values(d.books))) d.pos = e.pos;
    }
  }

  // Слова из старого словаря, которых нет ни в одной книге: книгу удалили.
  // Счётчики честно нулевые — свидетельств не осталось, — но статус живёт.
  const orphaned: string[] = [];
  for (const [lemma, old] of prev) {
    if (next.has(lemma)) continue;
    orphaned.push(lemma);
    next.set(lemma, { ...old, totalCount: 0, bookCount: 0, books: {} });
  }

  const added: string[] = [];
  const bookCountUp: RebuildDiff['bookCountUp'] = [];
  for (const [lemma, d] of next) {
    const old = prev.get(lemma);
    if (!old) { added.push(lemma); continue; }
    if (d.bookCount > old.bookCount) {
      bookCountUp.push({ lemma, from: old.bookCount, to: d.bookCount });
    }
  }

  const candidates = [...next.values()].filter(
    (d) => d.zipf < profile.knownZipf && d.speak === 'new' && d.read === 'new' && d.totalCount > 0,
  ).length;

  return {
    entries: next,
    diff: { books: books.length, total: next.size, added, bookCountUp, orphaned, candidates },
  };
}

export function writeNext(entries: Map<string, DictEntry>): void {
  saveDictionary(entries, NEXT_PATH);
}

export function applyNext(entries: Map<string, DictEntry>): void {
  saveDictionary(entries, dictPath);
}

export const hasNext = () => existsSync(NEXT_PATH);