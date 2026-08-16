import type { Token } from './tokenize.js';

export interface Entry {
  lemma: string;
  /** доминирующая часть речи */
  pos: string;
  /** распределение по POS — для диагностики: сильный разброс = теггер не уверен */
  posDist: Record<string, number>;
  /** формы, в которых лемма встретилась, со счётчиками */
  forms: Record<string, number>;
  /** позиции всех вхождений в тексте; количество = occurrences.length */
  occurrences: number[];
}

/** Похоже на слово: буквы, внутри допустимы апостроф и дефис. */
const WORDLIKE = /^[a-z][a-z'-]*$/;

/**
 * Поток токенов → записи по леммам.
 *
 * Ключ — ТОЛЬКО лемма, без части речи. Проверено на книге: настоящая
 * двойственность POS есть у 38 лемм из 1748 (2%), и почти все они частотные.
 * При этом теггер ошибается именно там, где разделение было бы нужно:
 * `stern` в значении «корма» размечен как ADJ во всех 23 вхождениях.
 * Разводить значения лучше позже, по контексту, а не по метке теггера.
 *
 * Отбрасываются PUNCT, SPACE, NUM и всё, что не похоже на слово.
 * Смысловая фильтрация (PROPN, частотность) — задача следующей стадии.
 */
export function aggregate(tokens: Token[]): Entry[] {
  const map = new Map<string, Entry>();

  for (const t of tokens) {
    const lemma = t.lemma.toLowerCase();
    if (!WORDLIKE.test(lemma)) continue;

    let e = map.get(lemma);
    if (!e) {
      e = { lemma, pos: t.pos, posDist: {}, forms: {}, occurrences: [] };
      map.set(lemma, e);
    }

    const form = t.form.toLowerCase();
    e.forms[form] = (e.forms[form] ?? 0) + 1;
    e.posDist[t.pos] = (e.posDist[t.pos] ?? 0) + 1;
    e.occurrences.push(t.start);
  }

  // доминирующий POS определяется только после полного прохода
  for (const e of map.values()) {
    e.pos = Object.entries(e.posDist).sort((a, b) => b[1] - a[1])[0][0];
  }

  return [...map.values()].sort((a, b) => b.occurrences.length - a.occurrences.length);
}