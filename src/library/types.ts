/** Форматы файлов в user/. Всё сериализуемо в JSON. */

// ─── user/books/<hash>.json ────────────────────────────────────────────

export interface BookEntry {
  lemma: string;
  /** доминирующая часть речи */
  pos: string;
  posDist: Record<string, number>;
  /** формы, в которых лемма встретилась */
  forms: Record<string, number>;
  /** позиции в user/books/<hash>.txt */
  occurrences: number[];
}

export interface BookFacts {
  /** sha256 исходного файла: защищает от повторного добавления */
  hash: string;
  title: string | null;
  author: string | null;
  format: string;
  /** имя исходного файла, только для показа человеку */
  sourceName: string;
  addedAt: string;
  wordCount: number;
  charCount: number;
  /**
   * Предполагаемые границы основного текста в <hash>.txt: где кончается
   * служебный блок — лицензии, титул, оглавление, реклама изданий.
   *
   * Текст сохраняется целиком, ничего не обрезано. Это подсказка для
   * интерфейса, решение принимает человек. Всегда числа: «границ не знаем»
   * выражается крайними значениями (0 и последняя строка), а не null —
   * иначе каждый потребитель разбирал бы этот случай отдельно.
   */
  expectedStartLine: number;
  /** включительно */
  expectedEndLine: number;
  entries: BookEntry[];
}

// ─── user/books/<hash>.contexts.json ───────────────────────────────────

/** лемма → примеры предложений из книги. Файл в .gitignore. */
export type BookContexts = Record<string, string[]>;

// ─── user/dictionary.jsonl ─────────────────────────────────────────────

export type DeckStatus = 'new' | 'proposed' | 'rejected' | 'accepted' | 'known';

export interface DictEntry {
  lemma: string;
  pos: string;
  /** частотность; 0 = нет в таблице */
  zipf: number;
  /** всего вхождений за всю историю чтения */
  totalCount: number;
  /** в скольких книгах встретилось — сигнал сильнее, чем totalCount */
  bookCount: number;
  /** hash книги → число вхождений в ней */
  books: Record<string, number>;
  speak: DeckStatus;
  read: DeckStatus;
}

// ─── user/profile.json ─────────────────────────────────────────────────

export interface Profile {
  /** выше этого слово считается известным и не предлагается */
  knownZipf: number;
  /** выше этого вообще не пишем в словарь (служебные слова) */
  recordZipf: number;
  dailyNew: { speak: number; read: number };
}

export const DEFAULT_PROFILE: Profile = {
  knownZipf: 4.0,
  recordZipf: 6.0,
  dailyNew: { speak: 5, read: 15 },
};