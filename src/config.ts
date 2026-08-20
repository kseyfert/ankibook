import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * Настройки, влияющие на ПОВЕДЕНИЕ системы: пороги, веса, лимиты.
 * Всё, что описывает конкретного пользователя (уровень языка), живёт
 * отдельно в user/profile.json. Секреты — только в окружении.
 *
 * Карта всех параметров: CONFIG.md
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export interface Tuning {
  contexts: { maxStored: number; minLength: number; maxShown: number };
  scoring: {
    floorZipf: number;
    saturation: number;
    historyOverride: number;
    speakThreshold: number;
    checkSenseRatio: number;
    speakWeights: { life: number; book: number };
    readWeights: { life: number; book: number };
  };
  review: { topSpeak: number; topRead: number };
  generation: { model: string; maxTokens: number; maxAttempts: number; defaultLimit: number };
}

const DEFAULTS: Tuning = {
  contexts: { maxStored: 10, minLength: 25, maxShown: 3 },
  scoring: {
    floorZipf: 2.0, saturation: 40, historyOverride: 3,
    speakThreshold: 0.5, checkSenseRatio: 50,
    speakWeights: { life: 0.7, book: 0.3 },
    readWeights: { life: 0.2, book: 0.8 },
  },
  review: { topSpeak: 30, topRead: 15 },
  generation: { model: 'claude-sonnet-4-6', maxTokens: 2000, maxAttempts: 3, defaultLimit: 10 },
};

function deepMerge<T>(base: T, over: Partial<T>): T {
  const out = { ...base };
  for (const k of Object.keys(over) as Array<keyof T>) {
    const v = over[k];
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      out[k] = deepMerge(base[k], v as Partial<T[keyof T]>);
    } else if (v !== undefined) {
      out[k] = v as T[keyof T];
    }
  }
  return out;
}

let cached: Tuning | null = null;

/** Значения из config/tuning.json поверх умолчаний. */
export function tuning(): Tuning {
  if (cached) return cached;
  const p = join(ROOT, 'config', 'tuning.json');
  cached = existsSync(p)
    ? deepMerge(DEFAULTS, JSON.parse(readFileSync(p, 'utf8')) as Partial<Tuning>)
    : DEFAULTS;
  return cached;
}

/**
 * Значение из аргументов командной строки: --limit 30
 * Аргументы важнее конфига — они меняются от запуска к запуску.
 */
export function argNum(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1 || i + 1 >= process.argv.length) return fallback;
  const v = Number(process.argv[i + 1]);
  return Number.isFinite(v) ? v : fallback;
}