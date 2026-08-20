import { addBook } from '../library/add-book.js';
import { llmIfConfigured } from '../llm/index.js';

const path = process.argv[2];
if (!path) { console.error('usage: npm run add -- <file>'); process.exit(1); }

// Без ключа книга разбирается как раньше — не будет только догадки
// о границах служебного текста.
const llm = llmIfConfigured();
if (!llm) console.error('ANTHROPIC_API_KEY не задан — границы книги не определяются\n');

try {
  const { facts, contextCount } = await addBook(path, llm);
  const lines = facts.expectedEndLine - facts.expectedStartLine + 1;
  console.log(`${facts.title ?? '?'} — ${facts.author ?? '?'}`);
  console.log(`hash ${facts.hash}   ${facts.wordCount} слов   ${facts.entries.length} лемм`);
  console.log(`контекстов собрано для ${contextCount} лемм`);
  console.log(`основной текст: строки ${facts.expectedStartLine}–${facts.expectedEndLine} (${lines})`);
  console.log(`\nсохранено:`);
  console.log(`  user/books/${facts.hash}.json`);
  console.log(`  user/books/${facts.hash}.txt`);
  console.log(`  user/books/${facts.hash}.contexts.json`);
} catch (e) {
  console.error(`Ошибка: ${(e as Error).message}`);
  process.exit(1);
}