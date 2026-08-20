import { readFileSync, existsSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { AnthropicLlm } from '../cards/llm.js';
import { tuning, argNum } from '../config/index.js';
import { generateCards, type Card } from '../cards/generate.js';
import { loadDictionary, listBooks, bookContextsPath, USER_DIR, ensureDirs } from '../library/files.js';
import type { BookContexts } from '../library/types.js';

const CARDS = join(USER_DIR, 'cards.jsonl');
const LIMIT = argNum('limit', tuning.generation.defaultLimit);

const books = listBooks();
if (!books.length) { console.error('Нет книг.'); process.exit(1); }
const book = books[books.length - 1];

const ctxPath = bookContextsPath(book.hash);
const contexts: BookContexts = existsSync(ctxPath) ? JSON.parse(readFileSync(ctxPath, 'utf8')) : {};

// уже сгенерированное не трогаем
const done = new Set<string>();
if (existsSync(CARDS)) {
  for (const l of readFileSync(CARDS, 'utf8').split('\n')) {
    if (l.trim()) { const c = JSON.parse(l) as Card; done.add(`${c.lemma}:${c.deck}`); }
  }
}

const dict = loadDictionary();
const speakTodo: Array<{ lemma: string; pos: string; deck: 'speak' | 'read' }> = [];
const readTodo: typeof speakTodo = [];
for (const d of dict.values()) {
  if (d.speak === 'proposed' && !done.has(`${d.lemma}:speak`)) speakTodo.push({ lemma: d.lemma, pos: d.pos, deck: 'speak' });
  if (d.read === 'proposed' && !done.has(`${d.lemma}:read`)) readTodo.push({ lemma: d.lemma, pos: d.pos, deck: 'read' });
}

/**
 * Колоды чередуются, а не идут подряд.
 *
 * Словарь отсортирован по алфавиту, поэтому простой список + LIMIT резал бы
 * по алфавиту: read-слова (oar, skiff, stern) стояли на позициях 16, 20 и 24
 * и при LIMIT=10 не обрабатывались никогда. Чередование даёт обеим колодам
 * долю в любом лимите — пропорционально их размеру.
 */
const todo: typeof speakTodo = [];
const ratio = speakTodo.length && readTodo.length
  ? Math.max(1, Math.round(speakTodo.length / readTodo.length))
  : Number.POSITIVE_INFINITY;
let si = 0, ri = 0;
while (si < speakTodo.length || ri < readTodo.length) {
  for (let k = 0; k < ratio && si < speakTodo.length; k++) todo.push(speakTodo[si++]);
  if (ri < readTodo.length) todo.push(readTodo[ri++]);
}

console.log(`ждут генерации: ${todo.length} (speak ${speakTodo.length}, read ${readTodo.length})`);
console.log(`обрабатываем ${Math.min(LIMIT, todo.length)}`);
if (!todo.length) process.exit(0);

const llm = new AnthropicLlm();
ensureDirs();
let ok = 0, flagged = 0;

for (const t of todo.slice(0, LIMIT)) {
  const ctx = contexts[t.lemma] ?? [];
  if (!ctx.length) { console.log(`  ${t.lemma}: нет контекстов, пропуск`); continue; }
  try {
    const cards = await generateCards(llm, t.lemma, t.pos, ctx, t.deck, book.hash);
    for (const c of cards) {
      appendFileSync(CARDS, JSON.stringify(c) + '\n');
      if (c.problems.length) { flagged++; console.log(`  ⚠ ${c.lemma} [${c.deck}]: ${c.problems[0]}`); }
      else { ok++; console.log(`  ✓ ${c.lemma} [${c.deck}]${c.sense ? ' — ' + c.sense : ''}: ${c.front.slice(0, 70)}`); }
    }
  } catch (e) {
    console.log(`  ✗ ${t.lemma}: ${(e as Error).message.slice(0, 90)}`);
  }
}

console.log(`\nчисто ${ok}, с замечаниями ${flagged}. Карточки в ${CARDS}`);