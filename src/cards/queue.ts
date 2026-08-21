import type { Card, Deck, DictEntry } from '../library/types.js';

/** Слово, ждущее генерации. */
export interface Pending {
  lemma: string;
  pos: string;
  deck: Deck;
  /** книги, где слово встречалось, — откуда брать примеры; чаще первым */
  books: string[];
}

export interface Queue {
  /** порядок обработки: колоды чередуются */
  todo: Pending[];
  speak: number;
  read: number;
}

const key = (lemma: string, deck: Deck) => `${lemma}:${deck}`;

/**
 * Что ещё предстоит сгенерировать.
 *
 * Берутся слова со статусом `proposed`, для которых карточки ещё нет.
 * Уже сгенерированное пропускается — прогон можно гонять частями,
 * это прямое следствие того, что каждая карточка стоит запроса к модели.
 *
 * КОЛОДЫ ЧЕРЕДУЮТСЯ, а не идут подряд. Словарь отсортирован по алфавиту,
 * поэтому простой список плюс лимит резал бы по алфавиту: на реальной книге
 * read-слова (oar, skiff, stern) стояли на позициях 16, 20 и 24 и при лимите
 * в десять не обрабатывались никогда. Чередование даёт обеим колодам долю
 * в любом лимите — пропорционально их размеру.
 */
export function buildQueue(dict: Map<string, DictEntry>, cards: Card[]): Queue {
  const done = new Set(cards.map((c) => key(c.lemma, c.deck)));

  const speak: Pending[] = [];
  const read: Pending[] = [];
  for (const d of dict.values()) {
    // Книга, где слово встречалось чаще, — первая: там больше шансов
    // на разнообразные примеры, а по одному вхождению значение не разведёшь.
    const books = Object.entries(d.books)
      .sort((a, b) => b[1] - a[1])
      .map(([hash]) => hash);

    if (d.speak === 'proposed' && !done.has(key(d.lemma, 'speak'))) {
      speak.push({ lemma: d.lemma, pos: d.pos, deck: 'speak', books });
    }
    if (d.read === 'proposed' && !done.has(key(d.lemma, 'read'))) {
      read.push({ lemma: d.lemma, pos: d.pos, deck: 'read', books });
    }
  }

  const ratio = speak.length && read.length
    ? Math.max(1, Math.round(speak.length / read.length))
    : Number.POSITIVE_INFINITY;

  const todo: Pending[] = [];
  let si = 0;
  let ri = 0;
  while (si < speak.length || ri < read.length) {
    for (let k = 0; k < ratio && si < speak.length; k++) todo.push(speak[si++]);
    if (ri < read.length) todo.push(read[ri++]);
  }

  return { todo, speak: speak.length, read: read.length };
}
