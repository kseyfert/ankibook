import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  listBooks, loadDictionary, saveDictionary, loadAllExcluded, dictPath, userDir,
} from './files.js';
import { SKIP_POS } from './pos.js';
import type { DictEntry, Profile } from './types.js';
import { zipf } from './freq.js';

/** Путь, а не константа: у каждого пользователя свой черновик словаря. */
export const nextPath = () => join(userDir(), 'dictionary.next.jsonl');

/**
 * Отказы пользователя: hash книги → леммы, которые он из неё не взял.
 *
 * Только для чтения: пересборка в них не пишет, и `ReadonlyMap` говорит это
 * компилятору, а не комментарию.
 */
export type Exclusions = ReadonlyMap<string, ReadonlySet<string>>;

/**
 * Пересборка, не знающая ни про какие отказы — «что вообще есть в книгах».
 *
 * Нужна шагу отбора: считай он по сохранённому решению, отказанное слово
 * исчезло бы из списка вместе с возможностью передумать.
 */
export const NO_EXCLUSIONS: Exclusions = new Map();

export interface RebuildDiff {
  books: number;
  total: number;
  added: string[];
  /** лемма → было/стало число книг */
  bookCountUp: Array<{ lemma: string; from: number; to: number }>;
  /** статус выставлен, но источников больше нет — книга удалена */
  orphaned: string[];
  /** строки без решений и без источников — выброшены из словаря */
  dropped: string[];
  /** слова, которых пользователь не захотел; в словарь не попадают */
  excluded: number;
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
 * Строка с РЕШЕНИЕМ не удаляется никогда: слово могло уехать в Noji, откуда
 * карточку не забрать. Потеряв статус, мы предложили бы его заново. Строки
 * без решений и без источников — просто мусор, они выбрасываются.
 */
export function rebuild(
  profile: Profile,
  excluded: Exclusions = loadAllExcluded(),
): { entries: Map<string, DictEntry>; diff: RebuildDiff } {
  const books = listBooks();
  const prev = loadDictionary();
  const next = new Map<string, DictEntry>();
  let skipped = 0;

  for (const book of books) {
    const notWanted = excluded.get(book.hash);
    for (const e of book.entries) {
      // Отказ пользователя на шаге отбора. Слово из этой книги в словарь
      // не попадает вовсе — ни строкой, ни статусом. Если та же лемма
      // придёт из другой книги и там будет нужна, она войдёт как новая:
      // отказ относится к книге, а не к слову вообще.
      if (notWanted?.has(e.lemma)) { skipped++; continue; }

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

  // Слова из старого словаря, которых нет ни в одной книге: книгу удалили
  // или пользователь отказался от слова на отборе.
  const orphaned: string[] = [];
  const dropped: string[] = [];
  for (const [lemma, old] of prev) {
    if (next.has(lemma)) continue;
    // Нетронутая строка без источников не несёт ничего: ни карточки, ни
    // решения. Держать её — значит копить в словаре мусор, который мешает
    // читать его глазами.
    if (old.speak === 'new' && old.read === 'new') { dropped.push(lemma); continue; }
    // Решение живёт даже без свидетельств: счётчики честно нулевые.
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
    diff: {
      books: books.length, total: next.size, added, bookCountUp,
      orphaned, dropped, excluded: skipped, candidates,
    },
  };
}

export function writeNext(entries: Map<string, DictEntry>): void {
  saveDictionary(entries, nextPath());
}

export function applyNext(entries: Map<string, DictEntry>): void {
  saveDictionary(entries, dictPath());
}

export const hasNext = () => existsSync(nextPath());