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
export const bookExcludedPath = (hash: string) => join(BOOKS_DIR, `${hash}.excluded.json`);

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

/**
 * Границы основного текста для книг, разобранных до того, как их научились
 * определять: в таких файлах полей просто нет, а тип обещает числа.
 *
 * Подставляем «резать нечего» — ноль и последнюю строку. Последнюю
 * приходится считать по <hash>.txt, и дёшево это не назвать; зато платится
 * только за старые книги, у новых поля записаны при разборе. Чинить сам
 * файл на чтении не станем: books/ — источник истины, и трогать его должен
 * тот, кто разбирает книгу, а не тот, кто её открывает.
 */
function withBounds(f: BookFacts): BookFacts {
  if (typeof f.expectedStartLine === 'number' && typeof f.expectedEndLine === 'number') return f;
  const p = bookTextPath(f.hash);
  const lineCount = existsSync(p) ? readFileSync(p, 'utf8').split('\n').length : 1;
  return { ...f, expectedStartLine: 0, expectedEndLine: lineCount - 1 };
}

export function loadBook(hash: string): BookFacts {
  return withBounds(JSON.parse(readFileSync(bookFactsPath(hash), 'utf8')) as BookFacts);
}

/** Нормализованный текст книги целиком. */
export function loadBookText(hash: string): string {
  return readFileSync(bookTextPath(hash), 'utf8');
}

/** Примеры предложений. Файла может не быть — книга разбиралась старой версией. */
export function loadContexts(hash: string): BookContexts {
  const p = bookContextsPath(hash);
  return existsSync(p) ? (JSON.parse(readFileSync(p, 'utf8')) as BookContexts) : {};
}

/** Сайдкары рядом с фактами книги. Всё, что не они, — сами факты. */
const SIDECARS = ['.contexts.json', '.excluded.json'];

export function listBooks(): BookFacts[] {
  if (!existsSync(BOOKS_DIR)) return [];
  return readdirSync(BOOKS_DIR)
    .filter((f) => f.endsWith('.json') && !SIDECARS.some((s) => f.endsWith(s)))
    .map((f) => withBounds(JSON.parse(readFileSync(join(BOOKS_DIR, f), 'utf8')) as BookFacts))
    .sort((a, b) => a.addedAt.localeCompare(b.addedAt));
}

// ─── исключённые слова ─────────────────────────────────────────────────

/**
 * Слова книги, которые пользователь решил в словарь не брать.
 *
 * Хранится СПИСОК ОТКАЗОВ, а не список включённых, потому что умолчание —
 * «берём всё»: нет файла — книга идёт в словарь целиком, и `npm run rebuild`
 * работает ровно как раньше. Список включённых потребовал бы записи по всем
 * трём тысячам лемм ради отказа от восьмисот.
 *
 * Отдельным файлом, а не полем в `<hash>.json`: тот файл описывает ТЕКСТ —
 * леммы, счётчики, позиции. Всё это выводится из книги и не зависит от
 * человека. Решение человека — не факт о книге, и смешивать их значит
 * потерять возможность переразобрать книгу, не затерев выбор.
 */
export function loadExcluded(hash: string): Set<string> {
  const p = bookExcludedPath(hash);
  if (!existsSync(p)) return new Set();
  return new Set(JSON.parse(readFileSync(p, 'utf8')) as string[]);
}

export function saveExcluded(hash: string, lemmas: Iterable<string>): void {
  ensureDirs();
  const sorted = [...lemmas].sort((a, b) => a.localeCompare(b));
  writeFileSync(bookExcludedPath(hash), JSON.stringify(sorted, null, 2));
}

/** hash книги → её исключённые леммы. Для пересборки словаря целиком. */
export function loadAllExcluded(): Map<string, Set<string>> {
  const m = new Map<string, Set<string>>();
  if (!existsSync(BOOKS_DIR)) return m;
  for (const f of readdirSync(BOOKS_DIR)) {
    if (!f.endsWith('.excluded.json')) continue;
    const hash = f.slice(0, -'.excluded.json'.length);
    m.set(hash, loadExcluded(hash));
  }
  return m;
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