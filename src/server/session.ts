import { readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { USER_DIR, ensureDirs } from '../library/files.js';
import type { Decision } from '../library/decisions.js';

/**
 * Сессия мастера — место для решений, которые ещё НЕ применены к словарю.
 *
 * CLI пишет решения сразу после каждого нажатия: там Ctrl+C не должен
 * обнулять работу. Веб-поток требует обратного — «Отменить» на последнем
 * шаге откатывает выбор колод, не трогая словарь.
 *
 * Лежит в файле, а не в памяти сервера: генерация карточек стоит денег
 * и минут, терять её при перезапуске или обновлении вкладки нельзя.
 */

const PATH = join(USER_DIR, 'session.json');

export type { Decision };

export interface JobState {
  id: string;
  status: 'running' | 'done' | 'error';
  done: number;
  total: number;
  failed: Array<{ lemma: string; error: string }>;
}

export interface Session {
  /** Растёт на каждой мутации. Фронт хранит копию и шлёт при записи. */
  version: number;
  step: 1 | 2 | 3 | 4 | 5 | 6;
  bookHash: string | null;
  /** Решения этого прохода. При отмене откатываются только они. */
  decisions: Record<string, Decision>;
  /** Карточки, снятые галочкой на шаге 5 — в экспорт не пойдут. */
  deselected: string[];
  /** Внутри сессии, чтобы после перезагрузки было видно: генерация идёт. */
  job: JobState | null;
}

export const emptySession = (): Session => ({
  version: 0,
  step: 1,
  bookHash: null,
  decisions: {},
  deselected: [],
  job: null,
});

export function loadSession(): Session {
  if (!existsSync(PATH)) return emptySession();
  try {
    return JSON.parse(readFileSync(PATH, 'utf8')) as Session;
  } catch {
    // битый файл лучше сбросить, чем уронить сервер на старте
    return emptySession();
  }
}

/** Записывает сессию, инкрементируя версию. */
export function saveSession(s: Session): Session {
  ensureDirs();
  const next = { ...s, version: s.version + 1 };
  writeFileSync(PATH, JSON.stringify(next, null, 2));
  return next;
}

export function clearSession(): void {
  if (existsSync(PATH)) rmSync(PATH);
}

/** Ошибка расхождения версий: клиент работал с устаревшей копией. */
export class VersionConflict extends Error {
  constructor(public readonly current: Session) {
    super('Сессия изменилась в другой вкладке');
  }
}

/**
 * Проверка версии перед мутацией.
 * Чтения версию не проверяют — иначе вторая вкладка не смогла бы
 * даже посмотреть состояние.
 */
export function requireVersion(expected: number | undefined): Session {
  const s = loadSession();
  if (expected !== undefined && expected !== s.version) throw new VersionConflict(s);
  return s;
}