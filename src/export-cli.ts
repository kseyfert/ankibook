import { readFileSync, writeFileSync, appendFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  loadDictionary, saveDictionary, EXPORTS_DIR, USER_DIR, ensureDirs,
} from './store/files.js';
import type { Card } from './generate.js';

const CARDS = join(USER_DIR, 'cards.jsonl');
const LOG = join(USER_DIR, 'exports.jsonl');

/** Экранирование по RFC 4180: кавычки удваиваются, поле берётся в кавычки. */
function csvField(s: string): string {
  return `"${s.replace(/"/g, '""')}"`;
}

interface ExportLogEntry {
  date: string;
  deck: 'speak' | 'read';
  file: string;
  count: number;
  lemmas: string[];
}

function main(): void {
  if (!existsSync(CARDS)) {
    console.error('Нет карточек. Сначала: npm run generate');
    process.exit(1);
  }

  const all: Card[] = readFileSync(CARDS, 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as Card);

  // Уже выгруженное определяем по журналу: карточка могла быть создана
  // в одном прогоне, а выгружена в другом.
  const exported = new Set<string>();
  if (existsSync(LOG)) {
    for (const l of readFileSync(LOG, 'utf8').split('\n')) {
      if (!l.trim()) continue;
      const e = JSON.parse(l) as ExportLogEntry;
      for (const lemma of e.lemmas) exported.add(`${lemma}:${e.deck}`);
    }
  }

  const dict = loadDictionary();
  const date = new Date().toISOString().slice(0, 10);
  ensureDirs();

  let totalCards = 0;
  const skipped = { flagged: 0, already: 0 };

  for (const deck of ['speak', 'read'] as const) {
    const cards = all.filter((c) => {
      if (c.deck !== deck) return false;
      if (exported.has(`${c.lemma}:${deck}`)) { skipped.already++; return false; }
      // Карточку из Noji нельзя ни исправить, ни удалить — брак не выпускаем.
      if (c.problems.length) { skipped.flagged++; return false; }
      return true;
    });
    if (!cards.length) continue;

    const file = join(EXPORTS_DIR, `${date}-${deck}.csv`);
    writeFileSync(file, cards.map((c) => `${csvField(c.front)},${csvField(c.back)}`).join('\n') + '\n');

    const lemmas = [...new Set(cards.map((c) => c.lemma))];

    // ПОРЯДОК ВАЖЕН: сначала журнал, потом статусы.
    // Упадём между ними — останется запись без accepted, и слово просто
    // выгрузится повторно. Обратный порядок дал бы accepted без файла,
    // то есть слово молча пропало бы навсегда.
    const entry: ExportLogEntry = { date, deck, file, count: cards.length, lemmas };
    appendFileSync(LOG, JSON.stringify(entry) + '\n');

    for (const lemma of lemmas) {
      const d = dict.get(lemma);
      if (d) d[deck] = 'accepted';
    }

    totalCards += cards.length;
    console.log(`${deck}: ${cards.length} карточек на ${lemmas.length} слов → ${file}`);
  }

  saveDictionary(dict);

  if (!totalCards) {
    console.log('Нечего выгружать.');
  }
  if (skipped.flagged) console.log(`пропущено с замечаниями: ${skipped.flagged}`);
  if (skipped.already) console.log(`уже выгружено ранее: ${skipped.already}`);

  const waiting = [...dict.values()].filter((d) => d.speak === 'proposed' || d.read === 'proposed').length;
  if (waiting) console.log(`ещё ждут карточек: ${waiting} слов`);
}

main();