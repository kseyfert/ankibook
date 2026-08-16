import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * Частотность слов по шкале Zipf.
 *
 * zipf = log10(вхождений на миллиард слов). Шкала логарифмическая:
 * шаг в единицу — разница в 10 раз.
 *
 *   7.7  the        одно на 20 слов
 *   5.0  rope       одно на 10 тыс.
 *   4.0  delicate   одно на 100 тыс.
 *   3.5  ordeal     одно на 320 тыс.
 *   2.7  gaff       одно на 2 млн
 *
 * Таблица собрана офлайн скриптом tools/build-freq.py из библиотеки
 * wordfreq (Python) и закоммичена. Это сознательно: значения не должны
 * меняться от обновления зависимости, иначе пороги отбора поедут молча.
 *
 * ВАЖНО: корпус wordfreq — это веб, субтитры и соцсети. В художественной
 * литературе слова вроде `gaunt` или `ordeal` встречаются заметно чаще,
 * чем показывает глобальная статистика. Считай эти значения стартовым
 * приближением, которое со временем стоит смешивать с личной частотностью
 * по прочитанным книгам.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const TABLE_PATH = join(HERE, '..', 'data', 'freq-en.txt');

/** Слово отсутствует в таблице: имя собственное, опечатка или очень редкое. */
export const UNKNOWN = 0;

let table: Map<string, number> | null = null;

function load(): Map<string, number> {
  if (table) return table;

  const m = new Map<string, number>();
  const raw = readFileSync(TABLE_PATH, 'utf8');

  for (const line of raw.split('\n')) {
    if (!line || line.startsWith('#')) continue;
    const tab = line.indexOf('\t');
    if (tab === -1) continue;
    const z = Number(line.slice(0, tab));
    for (const w of line.slice(tab + 1).split(' ')) {
      if (w) m.set(w, z);
    }
  }

  table = m;
  return m;
}

/** Частотность слова. UNKNOWN (0), если слова нет в таблице. */
export function zipf(word: string): number {
  return load().get(word.toLowerCase()) ?? UNKNOWN;
}

export function tableSize(): number {
  return load().size;
}