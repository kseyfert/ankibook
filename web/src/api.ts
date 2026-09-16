/**
 * Единственное место в приложении, где есть fetch.
 * Компоненты про HTTP не знают — это условие для смены дизайна
 * без правки логики.
 */

export type Decision = 'speak' | 'read' | 'known' | 'rejected';

export interface Session {
  version: number;
  step: 1 | 2 | 3 | 4 | 5 | 6;
  bookHash: string | null;
  decisions: Record<string, Decision>;
  deselected: string[];
  /** файлы, записанные выгрузкой этого прохода */
  exported: string[];
  job: null | {
    id: string;
    status: 'running' | 'done' | 'error' | 'cancelled';
    done: number;
    total: number;
    failed: Array<{ lemma: string; error: string }>;
  };
}

export interface BookSummary {
  hash: string;
  title: string | null;
  author: string | null;
  sourceName: string;
  addedAt: string;
  wordCount: number;
  /** сколько лемм книги взято в словарь */
  inDictionary: number;
  /** сколько уже уехало в Noji; слово могло уехать и с другой книгой */
  exported: number;
}

export interface BookInfo {
  hash: string;
  title: string | null;
  author: string | null;
  sourceName: string;
  wordCount: number;
  charCount: number;
  lemmaCount: number;
  contextCount: number;
  /**
   * Где, по мнению модели, начинается и кончается основной текст: за этими
   * границами лицензии, титул, оглавление, реклама изданий. Ничего не
   * обрезано, текст сохранён целиком — это подсказка к будущему шагу разбора.
   * 0 и последняя строка означают «резать нечего».
   */
  expectedStartLine: number;
  expectedEndLine: number;
}

export interface DiffWord {
  lemma: string;
  pos: string;
  posLabel: string;
  zipf: number;
  /**
   * Номера строк, в которых слово встретилось — по одному на вхождение.
   * Счётчик «в книге» считается из них с учётом выбранных границ текста:
   * слово из лицензии в словарь не идёт, даже если встретилось двадцать раз.
   */
  lines: number[];
  /** книга — единственный источник слова: отказ убирает его из словаря целиком */
  onlyHere: boolean;
}

export interface Bounds {
  /** предположение модели: первая строка основного текста */
  start: number;
  /** последняя строка основного текста, включительно */
  end: number;
  /** последняя строка файла */
  lastLine: number;
  /** превью строк 0…headPreviews.length-1; пустая строка = пустая в тексте */
  headPreviews: string[];
  /** номер строки, которой соответствует tailPreviews[0] */
  tailFrom: number;
  tailPreviews: string[];
}

export interface Diff {
  book: { hash: string; title: string | null; wordCount: number };
  totalLemmas: number;
  added: number;
  bookCountUp: number;
  knownZipf: number;
  /** верх шкалы: выше этого слова в словарь не пишутся вообще */
  recordZipf: number;
  /** от чего уже отказывались по этой книге */
  excluded: string[];
  bounds: Bounds;
  words: DiffWord[];
}

export interface CandidateWord {
  lemma: string;
  pos: string;
  posLabel: string;
  zipf: number;
  countInBook: number;
  totalCount: number;
  bookCount: number;
  suggested: 'speak' | 'read';
  reason: string;
  /** частое слово, здесь резко переизбыточное — проверить значение глазами */
  checkSense: boolean;
  /** во сколько раз чаще ожидаемого; null, если слова нет в частотной таблице */
  overrepresentation: number | null;
  contexts: string[];
}

export interface Candidates {
  book: { hash: string; title: string | null; wordCount: number };
  knownZipf: number;
  /** сколько всего слов этой книги ждут отбора */
  eligible: number;
  /** сколько осталось за пределами показанного топа */
  remaining: number;
  limits: { speak: number; read: number };
  words: { speak: CandidateWord[]; read: CandidateWord[] };
}

export interface Pending {
  /** сколько слов ждёт генерации */
  total: number;
  speak: number;
  read: number;
  running: boolean;
  defaultLimit: number;
  /** сколько взять самому, если карточек ещё нет */
  autoStart: number;
}

export interface CardView {
  id: string;
  lemma: string;
  deck: 'speak' | 'read';
  /** null, если у слова одно значение */
  sense: string | null;
  front: string;
  back: string;
  /** замечания валидатора; непустой список — в экспорт не пойдёт */
  problems: string[];
  /** человек прочитал замечания и всё равно берёт карточку */
  approved: boolean;
  selected: boolean;
}

export interface CardList {
  cards: CardView[];
  clean: number;
  flagged: number;
  /** уже уехали в Noji: показывать нечего, но и молчать про них нельзя */
  exported: number;
}

export interface ExportEntry {
  date: string;
  deck: 'speak' | 'read';
  file: string;
  count: number;
  lemmas: string[];
}

export interface ExportFile extends ExportEntry {
  csv: string;
}

export interface ExportState {
  /** уже записанное этим проходом; пусто — выгрузки ещё не было */
  files: ExportFile[];
  /** сколько карточек готово уехать */
  pending: number;
  skipped: { flagged: number; deselected: number; already: number };
  history: ExportEntry[];
}

export interface ExportResult {
  files: ExportFile[];
  skipped: ExportState['skipped'];
  session: Session;
}

/** Расхождение версий: кто-то менял сессию в другой вкладке. */
export class ConflictError extends Error {
  constructor(public readonly session: Session) {
    super('Сессия изменилась в другой вкладке');
  }
}

/**
 * За кого работаем. Держится здесь, а не передаётся в каждый вызов:
 * пользователь — свойство всей работы, а не отдельного запроса.
 */
let user = 'Default';

export const setApiUser = (name: string) => { user = name; };

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    // Без кодирования: допустимые имена — латиница, цифры, дефис
    // и подчёркивание, всё это заголовок несёт как есть.
    headers: { ...init?.headers, 'x-user': user },
  });
  const body = await res.json();
  if (res.status === 409) throw new ConflictError(body.session);
  if (!res.ok) throw new Error(body.error ?? `Ошибка ${res.status}`);
  return body as T;
}

const json = (data: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(data),
});

export const api = {
  getSession: () => req<Session>('/session'),
  setStep: (step: number, version: number) => req<Session>('/session/step', json({ step, version })),
  resetSession: () => req<Session>('/session', { method: 'DELETE' }),

  selectBook: (hash: string, version: number) =>
    req<Session>('/session/book', json({ hash, version })),
  saveDecisions: (decisions: Record<string, Decision>, version: number) =>
    req<Session>('/session/decisions', json({ decisions, version })),
  applyDecisions: (version: number) =>
    req<{ applied: number; counts: Record<Decision, number>; session: Session }>(
      '/decisions/apply',
      json({ version }),
    ),

  getPending: () => req<Pending>('/cards/pending'),
  generate: (limit: number) => req<{ job: Session['job'] }>('/cards/generate', json({ limit })),
  cancelJob: () => req<{ job: Session['job'] }>('/cards/cancel', { method: 'POST' }),
  listCards: () => req<CardList>('/cards'),
  regenerateCard: (id: string) =>
    req<{ card: CardView }>(`/cards/${id}/regenerate`, { method: 'POST' }),
  editCard: (id: string, patch: { front?: string; back?: string }) =>
    req<{ card: CardView }>(`/cards/${id}`, { ...json(patch), method: 'PATCH' }),
  approveCard: (id: string, approved: boolean) =>
    req<{ card: CardView }>(`/cards/${id}/approve`, json({ approved })),
  deselect: (deselected: string[], version: number) =>
    req<Session>('/cards/deselect', json({ deselected, version })),

  listUsers: () => req<{ users: string[] }>('/users'),
  createUser: (name: string) => req<{ name: string; users: string[] }>('/users', json({ name })),

  exportState: () => req<ExportState>('/export'),
  runExport: (version: number) => req<ExportResult>('/export', json({ version })),
  undoExport: () => req<{ undone: number; session: Session }>('/export/undo', { method: 'POST' }),

  listBooks: () => req<BookSummary[]>('/books'),
  uploadBook: (file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return req<{ book: BookInfo; session: Session }>('/books', { method: 'POST', body: fd });
  },
  getDiff: (hash: string) => req<Diff>(`/books/${hash}/diff`),
  getCandidates: (hash: string, speak: number, read: number) =>
    req<Candidates>(`/books/${hash}/candidates?speak=${speak}&read=${read}`),
  applyDictionary: (hash: string, excluded: string[]) =>
    req<{ total: number; added: number; candidates: number; excluded: number; dropped: number }>(
      '/dictionary/apply',
      json({ hash, excluded }),
    ),
};