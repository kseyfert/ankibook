import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { AsyncLocalStorage } from 'node:async_hooks';
import { join } from 'node:path';
import type { BookFacts, BookContexts, Card, DictEntry, ExportLogEntry, Profile } from './types.js';
import { DEFAULT_USER, userDir as userPath } from './users.js';
import { DEFAULT_PROFILE } from './types.js';

/**
 * Где лежат данные того, за кого мы сейчас работаем.
 *
 * Пути стали функциями, а не константами: пользователей несколько, и папка
 * зависит от того, чей запрос обрабатывается прямо сейчас.
 *
 * Текущий пользователь живёт в AsyncLocalStorage, а не в переменной модуля.
 * Разница не теоретическая: генерация карточек идёт минутами, и за это время
 * успевает прийти запрос другого пользователя. Простая переменная к тому
 * моменту уже поменялась бы, и продолжение задачи записало бы карточки
 * в чужую папку. Контекст же наследуется всеми await внутри задачи.
 */
const context = new AsyncLocalStorage<string>();

/** Для CLI: у команды нет запросов, пользователь задаётся на весь процесс. */
let processUser = DEFAULT_USER;

export const setProcessUser = (name: string) => { processUser = name; };

/** Выполняет работу от имени пользователя. Все await внутри её унаследуют. */
export const runAsUser = <T>(name: string, fn: () => T): T => context.run(name, fn);

export const currentUser = (): string => context.getStore() ?? processUser;

export const userDir = () => userPath(currentUser());
export const booksDir = () => join(userDir(), 'books');
export const exportsDir = () => join(userDir(), 'exports');

export const dictPath = () => join(userDir(), 'dictionary.jsonl');
export const cardsPath = () => join(userDir(), 'cards.jsonl');
export const exportLogPath = () => join(userDir(), 'exports.jsonl');
export const profilePath = () => join(userDir(), 'profile.json');
export const sessionPath = () => join(userDir(), 'session.json');

export const bookFactsPath = (hash: string) => join(booksDir(), `${hash}.json`);
export const bookTextPath = (hash: string) => join(booksDir(), `${hash}.txt`);
export const bookContextsPath = (hash: string) => join(booksDir(), `${hash}.contexts.json`);
export const bookExcludedPath = (hash: string) => join(booksDir(), `${hash}.excluded.json`);

export function ensureDirs(): void {
  for (const d of [userDir(), booksDir(), exportsDir()]) {
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
 * на слово. Устареть кэш не может: хэш считается от содержимого файла,
 * у изменившейся книги будет другой ключ.
 *
 * В ключе ещё и пользователь: хэш у одной и той же книги общий, а файлы
 * лежат в разных папках. Без имени контексты Веры доставались бы Кеше.
 */
const contextCache = new Map<string, BookContexts>();

function cachedContexts(hash: string): BookContexts {
  const key = `${currentUser()}/${hash}`;
  let c = contextCache.get(key);
  if (!c) { c = loadContexts(hash); contextCache.set(key, c); }
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
  if (!existsSync(booksDir())) return [];
  return readdirSync(booksDir())
    .filter((f) => f.endsWith('.json') && !SIDECARS.some((s) => f.endsWith(s)))
    .map((f) => withBounds(JSON.parse(readFileSync(join(booksDir(), f), 'utf8')) as BookFacts))
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
  if (!existsSync(booksDir())) return m;
  for (const f of readdirSync(booksDir())) {
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
export function loadDictionary(path = dictPath()): Map<string, DictEntry> {
  const m = new Map<string, DictEntry>();
  if (!existsSync(path)) return m;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    const e = JSON.parse(line) as DictEntry;
    m.set(e.lemma, e);
  }
  return m;
}

export function saveDictionary(entries: Map<string, DictEntry>, path = dictPath()): void {
  ensureDirs();
  const lines = [...entries.values()]
    .sort((a, b) => a.lemma.localeCompare(b.lemma))
    .map((e) => JSON.stringify(e));
  writeFileSync(path, lines.join('\n') + '\n');
}


// ─── карточки ──────────────────────────────────────────────────────────

/**
 * JSONL и дозапись по одной: генерация идёт минутами и стоит денег.
 * Упасть на середине — значит потерять только незаписанную карточку,
 * а не весь прогон.
 */
export function loadCards(): Card[] {
  if (!existsSync(cardsPath())) return [];
  return readFileSync(cardsPath(), 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as Card);
}

export function appendCard(card: Card): void {
  ensureDirs();
  appendFileSync(cardsPath(), JSON.stringify(card) + '\n');
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
  writeFileSync(cardsPath(), cards.map((c) => JSON.stringify(c)).join('\n') + '\n');
}


// ─── выгрузки ──────────────────────────────────────────────────────────

export function loadExportLog(): ExportLogEntry[] {
  if (!existsSync(exportLogPath())) return [];
  return readFileSync(exportLogPath(), 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as ExportLogEntry);
}

export function appendExportLog(entry: ExportLogEntry): void {
  ensureDirs();
  appendFileSync(exportLogPath(), JSON.stringify(entry) + '\n');
}

/** Перезапись журнала целиком — нужна только откату выгрузки. */
export function saveExportLog(entries: ExportLogEntry[]): void {
  ensureDirs();
  writeFileSync(exportLogPath(), entries.map((e) => JSON.stringify(e)).join('\n') + (entries.length ? '\n' : ''));
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
  let file = join(exportsDir(), `${date}-${deck}.csv`);
  for (let n = 2; existsSync(file); n++) {
    file = join(exportsDir(), `${date}-${deck}-${n}.csv`);
  }
  writeFileSync(file, body);
  return file;
}

// ─── профиль ───────────────────────────────────────────────────────────

export function loadProfile(): Profile {
  if (!existsSync(profilePath())) return { ...DEFAULT_PROFILE };
  return { ...DEFAULT_PROFILE, ...JSON.parse(readFileSync(profilePath(), 'utf8')) };
}