import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { BookFacts, BookContexts, Card, DictEntry, ExportLogEntry, Profile } from './types.js';
import { DEFAULT_PROFILE } from './types.js';

export const USER_DIR = 'user';
export const BOOKS_DIR = join(USER_DIR, 'books');
export const EXPORTS_DIR = join(USER_DIR, 'exports');

const DICT = join(USER_DIR, 'dictionary.jsonl');
const CARDS = join(USER_DIR, 'cards.jsonl');
const EXPORT_LOG = join(USER_DIR, 'exports.jsonl');
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

/**
 * Кэш контекстов по книгам.
 *
 * Файл на книгу — сотни килобайт, а генерация спрашивает его по разу
 * на слово. Устареть кэш не может: ключ — хэш файла, у изменившейся книги
 * будет другой ключ.
 */
const contextCache = new Map<string, BookContexts>();

function cachedContexts(hash: string): BookContexts {
  let c = contextCache.get(hash);
  if (!c) { c = loadContexts(hash); contextCache.set(hash, c); }
  return c;
}

/**
 * Примеры для слова: сначала из предпочтительной книги, потом из любой,
 * где оно встречалось.
 *
 * Брать только из книги текущего прохода нельзя: слово могло быть отобрано
 * прошлым проходом по другой книге и остаться в очереди. Примеров в этой
 * книге у него нет — и карточка не сделалась бы никогда.
 */
export function contextsFor(lemma: string, books: string[], prefer?: string): string[] {
  const order = prefer ? [prefer, ...books.filter((h) => h !== prefer)] : books;
  for (const hash of order) {
    const found = cachedContexts(hash)[lemma];
    if (found?.length) return found;
  }
  return [];
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

// ─── карточки ──────────────────────────────────────────────────────────

/**
 * JSONL и дозапись по одной: генерация идёт минутами и стоит денег.
 * Упасть на середине — значит потерять только незаписанную карточку,
 * а не весь прогон.
 */
export function loadCards(): Card[] {
  if (!existsSync(CARDS)) return [];
  return readFileSync(CARDS, 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as Card);
}

export function appendCard(card: Card): void {
  ensureDirs();
  appendFileSync(CARDS, JSON.stringify(card) + '\n');
}

/**
 * Перезапись файла целиком — для правки и перегенерации.
 *
 * Дозапись тут не годится: карточка меняется на месте, а два JSON с одним
 * id означали бы, что верной считается то первая, то последняя, смотря кто
 * читает. Порядок сохраняется, потому что по нему человек их и просматривает.
 */
export function saveCards(cards: Card[]): void {
  ensureDirs();
  writeFileSync(CARDS, cards.map((c) => JSON.stringify(c)).join('\n') + '\n');
}

export const cardsPath = CARDS;

// ─── выгрузки ──────────────────────────────────────────────────────────

export function loadExportLog(): ExportLogEntry[] {
  if (!existsSync(EXPORT_LOG)) return [];
  return readFileSync(EXPORT_LOG, 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as ExportLogEntry);
}

export function appendExportLog(entry: ExportLogEntry): void {
  ensureDirs();
  appendFileSync(EXPORT_LOG, JSON.stringify(entry) + '\n');
}

/** Перезапись журнала целиком — нужна только откату выгрузки. */
export function saveExportLog(entries: ExportLogEntry[]): void {
  ensureDirs();
  writeFileSync(EXPORT_LOG, entries.map((e) => JSON.stringify(e)).join('\n') + (entries.length ? '\n' : ''));
}

export function removeExportCsv(file: string): void {
  rmSync(file, { force: true });
}

export function readExportCsv(file: string): string {
  return existsSync(file) ? readFileSync(file, 'utf8') : '';
}

/**
 * Пишет CSV и возвращает путь.
 *
 * Имя занято — берём следующее с номером. Раньше файл просто затирался,
 * и вторая выгрузка за день оставляла в журнале две записи, указывающие
 * на один файл с содержимым только последней.
 */
export function writeExportCsv(date: string, deck: string, body: string): string {
  ensureDirs();
  let file = join(EXPORTS_DIR, `${date}-${deck}.csv`);
  for (let n = 2; existsSync(file); n++) {
    file = join(EXPORTS_DIR, `${date}-${deck}-${n}.csv`);
  }
  writeFileSync(file, body);
  return file;
}

// ─── профиль ───────────────────────────────────────────────────────────

export function loadProfile(): Profile {
  if (!existsSync(PROFILE)) return { ...DEFAULT_PROFILE };
  return { ...DEFAULT_PROFILE, ...JSON.parse(readFileSync(PROFILE, 'utf8')) };
}