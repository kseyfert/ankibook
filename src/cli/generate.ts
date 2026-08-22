import { AnthropicLlm } from '../llm/index.js';
import { tuning, argNum } from '../config/index.js';
import { generateCards } from '../cards/generate.js';
import { buildQueue } from '../cards/queue.js';
import {
  loadDictionary, listBooks, contextsFor, loadCards, appendCard, cardsPath,
  setProcessUser, currentUser,
} from '../library/files.js';
import { DEFAULT_USER } from '../library/users.js';
import { argStr } from '../config/index.js';

// За кого работаем: `--user Вера`. Без флага — Default.
setProcessUser(argStr('user', DEFAULT_USER));

const LIMIT = argNum('limit', tuning.generation.defaultLimit);

const books = listBooks();
if (!books.length) { console.error(`У пользователя ${currentUser()} нет книг.`); process.exit(1); }
const book = books[books.length - 1];

const { todo, speak, read } = buildQueue(loadDictionary(), loadCards());

console.log(`ждут генерации: ${todo.length} (speak ${speak}, read ${read})`);
console.log(`обрабатываем ${Math.min(LIMIT, todo.length)}`);
if (!todo.length) process.exit(0);

const llm = new AnthropicLlm();
let ok = 0, flagged = 0;

for (const t of todo.slice(0, LIMIT)) {
  const ctx = contextsFor(t.lemma, t.books, book.hash);
  if (!ctx.length) { console.log(`  ${t.lemma}: нет контекстов, пропуск`); continue; }
  try {
    const cards = await generateCards(llm, t.lemma, t.pos, ctx, t.deck, book.hash);
    for (const c of cards) {
      appendCard(c);
      if (c.problems.length) { flagged++; console.log(`  ⚠ ${c.lemma} [${c.deck}]: ${c.problems[0]}`); }
      else { ok++; console.log(`  ✓ ${c.lemma} [${c.deck}]${c.sense ? ' — ' + c.sense : ''}: ${c.front.slice(0, 70)}`); }
    }
  } catch (e) {
    console.log(`  ✗ ${t.lemma}: ${(e as Error).message.slice(0, 90)}`);
  }
}

console.log(`\nчисто ${ok}, с замечаниями ${flagged}. Карточки в ${cardsPath}`);