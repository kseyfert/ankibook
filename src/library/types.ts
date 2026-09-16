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

/** Колода. Слово попадает ровно в одну: произносить умеешь — узнаешь и так. */
export type Deck = 'speak' | 'read';

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

// ─── user/cards.jsonl ──────────────────────────────────────────────────

export interface Card {
  id: string;
  lemma: string;
  deck: Deck;
  /** null, если значение одно */
  sense: string | null;
  front: string;
  back: string;
  /** ответ — для валидации; в CSV не идёт */
  answer: string;
  bookHash: string;
  createdAt: string;
  /** замечания валидатора; непустой список — в экспорт не пойдёт */
  problems: string[];
  /**
   * Замечания, которые человек прочитал и всё равно взял карточку.
   *
   * Валидатор не всеведущ: «контекст допускает anyway наравне с anyhow»
   * бывает и придиркой. Последнее слово за человеком, но сказать его надо
   * явно, глядя на текст.
   *
   * Хранятся сами замечания, а не флаг «одобрено»: согласие относится
   * к тому, что человек прочитал. Правка и перегенерация дают другой
   * список — и согласие перестаёт совпадать само, без отдельного сброса,
   * который однажды забудут поставить.
   */
  approved?: string[];
}

// ─── user/exports.jsonl ────────────────────────────────────────────────

/**
 * Запись журнала выгрузок.
 *
 * Журнал, а не статусы слов, отвечает на вопрос «что уже уехало»: карточка
 * могла быть создана в одном прогоне, а выгружена в другом.
 */
export interface ExportLogEntry {
  date: string;
  deck: Deck;
  file: string;
  count: number;
  lemmas: string[];
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