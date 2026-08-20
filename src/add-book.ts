import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { basename } from 'node:path';
import { ingest } from './ingest.js';
import { tokenize } from './tokenize.js';
import { aggregate } from './aggregate.js';
import { bookExists, saveBook } from './store/files.js';
import type { BookFacts, BookContexts, BookEntry } from './store/types.js';
import { tuning } from './config.js';



/**
 * Равномерная выборка n элементов из массива.
 *
 * Не первые n: у 36% лемм вхождений больше трёх, и первые три покрывают
 * в среднем лишь 39% диапазона слова по тексту. То есть выборка подряд
 * берёт только начало книги, где употребление может быть однообразным,
 * и второе значение слова в неё не попадает.
 */
function evenly<T>(arr: T[], n: number): T[] {
  if (arr.length <= n) return arr;
  const step = (arr.length - 1) / (n - 1);
  return Array.from({ length: n }, (_, i) => arr[Math.round(i * step)]);
}

/**
 * Предложение вокруг позиции.
 *
 * Границы — ближайшие «. » или «\n\n», что встретится раньше. Массив абзацев
 * для этого не нужен: разделитель абзацев ищется наравне с точкой, поэтому
 * контекст не перескакивает через границу и не склеивает двух говорящих.
 */
function sentenceAt(text: string, pos: number): string {
  const dotL = text.lastIndexOf('. ', pos);
  const parL = text.lastIndexOf('\n\n', pos);
  // Math.max с нулём ДО прибавления смещения, иначе -1 превращается в +1
  const from = Math.max(dotL === -1 ? 0 : dotL + 2, parL === -1 ? 0 : parL + 2, 0);

  const dotR = text.indexOf('. ', pos);
  const parR = text.indexOf('\n\n', pos);
  const to = Math.min(
    dotR === -1 ? Infinity : dotR + 1,
    parR === -1 ? Infinity : parR,
    text.length,
  );

  return text.slice(from, to).replace(/\s+/g, ' ').trim();
}

/**
 * Контексты собираются из текста и позиций на лету — отдельно хранить
 * их при разборе не обязательно, но файл нагляднее при отладке.
 */
function collectContexts(text: string, entries: BookEntry[]): BookContexts {
  const out: BookContexts = {};
  for (const e of entries) {
    // выборка с запасом: часть предложений отсеется по длине или как дубли
    const { maxStored, minLength } = tuning().contexts;
    const picked = evenly(e.occurrences, maxStored * 2);
    const seen = new Set<string>();
    for (const pos of picked) {
      if (seen.size >= maxStored) break;
      const s = sentenceAt(text, pos);
      if (s.length >= minLength) seen.add(s);
    }
    if (seen.size) out[e.lemma] = [...seen];
  }
  return out;
}

export interface AddResult {
  facts: BookFacts;
  contextCount: number;
}

export async function addBook(path: string): Promise<AddResult> {
  const hash = createHash('sha256').update(readFileSync(path)).digest('hex').slice(0, 16);

  if (bookExists(hash)) {
    throw new Error(
      `Книга уже добавлена (hash ${hash}). Повторное добавление удвоило бы счётчики.`,
    );
  }

  const doc = await ingest(path);
  const entries = aggregate(tokenize(doc.text));

  const facts: BookFacts = {
    hash,
    title: doc.meta.title,
    author: doc.meta.author,
    format: doc.meta.format,
    sourceName: basename(path),
    addedAt: new Date().toISOString(),
    wordCount: doc.meta.wordCount,
    charCount: doc.meta.charCount,
    entries,
  };

  const contexts = collectContexts(doc.text, entries);
  saveBook(facts, doc.text, contexts);

  return { facts, contextCount: Object.keys(contexts).length };
}