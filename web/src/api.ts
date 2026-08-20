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
  job: null | { id: string; status: string; done: number; total: number };
}

export interface BookSummary {
  hash: string;
  title: string | null;
  author: string | null;
  sourceName: string;
  addedAt: string;
  wordCount: number;
  lemmaCount: number;
  candidatesLeft: number;
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
}

export interface DiffWord {
  lemma: string;
  pos: string;
  posLabel: string;
  zipf: number;
  count: number;
}

export interface Diff {
  book: { hash: string; title: string | null; wordCount: number };
  totalLemmas: number;
  added: number;
  bookCountUp: number;
  candidates: number;
  knownZipf: number;
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

/** Расхождение версий: кто-то менял сессию в другой вкладке. */
export class ConflictError extends Error {
  constructor(public readonly session: Session) {
    super('Сессия изменилась в другой вкладке');
  }
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, init);
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

  listBooks: () => req<BookSummary[]>('/books'),
  uploadBook: (file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return req<{ book: BookInfo; session: Session }>('/books', { method: 'POST', body: fd });
  },
  getDiff: (hash: string) => req<Diff>(`/books/${hash}/diff`),
  getCandidates: (hash: string, speak: number, read: number) =>
    req<Candidates>(`/books/${hash}/candidates?speak=${speak}&read=${read}`),
  applyDictionary: (rejected: string[]) =>
    req<{ total: number; added: number; candidates: number; rejected: number }>(
      '/dictionary/apply',
      json({ rejected }),
    ),
};