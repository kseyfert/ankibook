import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { BookFacts, BookContexts, DictEntry, Profile } from './types.js';
import { DEFAULT_PROFILE } from './types.js';

export const USER_DIR = 'user';
export const BOOKS_DIR = join(USER_DIR, 'books');
export const EXPORTS_DIR = join(USER_DIR, 'exports');

const DICT = join(USER_DIR, 'dictionary.jsonl');
const PROFILE = join(USER_DIR, 'profile.json');

export const bookFactsPath = (hash: string) => join(BOOKS_DIR, `${hash}.json`);
export const bookTextPath = (hash: string) => join(BOOKS_DIR, `${hash}.txt`);
export const bookContextsPath = (hash: string) => join(BOOKS_DIR, `${hash}.contexts.json`);

export function ensureDirs(): void {
  for (const d of [USER_DIR, BOOKS_DIR, EXPORTS_DIR]) {
    if (!existsSync(d)) mkdirSync(d, { recursive: true });
  }
}

// ─── книги ─────────────────────────────────────────────────────────────

export const bookExists = (hash: string) => existsSync(bookFactsPath(hash));

export function saveBook(facts: BookFacts, text: string, contexts: BookContexts): void {
  ensureDirs();
  writeFileSync(bookFactsPath(facts.hash), JSON.stringify(facts, null, 2));
  writeFileSync(bookTextPath(facts.hash), text);
  writeFileSync(bookContextsPath(facts.hash), JSON.stringify(contexts, null, 2));
}

export function loadBook(hash: string): BookFacts {
  return JSON.parse(readFileSync(bookFactsPath(hash), 'utf8')) as BookFacts;
}

/** Примеры предложений. Файла может не быть — книга разбиралась старой версией. */
export function loadContexts(hash: string): BookContexts {
  const p = bookContextsPath(hash);
  return existsSync(p) ? (JSON.parse(readFileSync(p, 'utf8')) as BookContexts) : {};
}

export function listBooks(): BookFacts[] {
  if (!existsSync(BOOKS_DIR)) return [];
  return readdirSync(BOOKS_DIR)
    .filter((f) => f.endsWith('.json') && !f.endsWith('.contexts.json'))
    .map((f) => JSON.parse(readFileSync(join(BOOKS_DIR, f), 'utf8')) as BookFacts)
    .sort((a, b) => a.addedAt.localeCompare(b.addedAt));
}

// ─── словарь ───────────────────────────────────────────────────────────

/**
 * JSONL, а не JSON: строка на лемму. Так файл читается построчно,
 * грепается и нормально выглядит в git diff — при слиянии книги меняются
 * отдельные строки, а не весь файл целиком.
 */
export function loadDictionary(path = DICT): Map<string, DictEntry> {
  const m = new Map<string, DictEntry>();
  if (!existsSync(path)) return m;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    const e = JSON.parse(line) as DictEntry;
    m.set(e.lemma, e);
  }
  return m;
}

export function saveDictionary(entries: Map<string, DictEntry>, path = DICT): void {
  ensureDirs();
  const lines = [...entries.values()]
    .sort((a, b) => a.lemma.localeCompare(b.lemma))
    .map((e) => JSON.stringify(e));
  writeFileSync(path, lines.join('\n') + '\n');
}

export const dictPath = DICT;

// ─── профиль ───────────────────────────────────────────────────────────

export function loadProfile(): Profile {
  if (!existsSync(PROFILE)) return { ...DEFAULT_PROFILE };
  return { ...DEFAULT_PROFILE, ...JSON.parse(readFileSync(PROFILE, 'utf8')) };
}