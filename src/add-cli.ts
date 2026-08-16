import { addBook } from './add-book.js';

const path = process.argv[2];
if (!path) { console.error('usage: npm run add -- <file>'); process.exit(1); }

try {
  const { facts, contextCount } = await addBook(path);
  console.log(`${facts.title ?? '?'} — ${facts.author ?? '?'}`);
  console.log(`hash ${facts.hash}   ${facts.wordCount} слов   ${facts.entries.length} лемм`);
  console.log(`контекстов собрано для ${contextCount} лемм`);
  console.log(`\nсохранено:`);
  console.log(`  user/books/${facts.hash}.json`);
  console.log(`  user/books/${facts.hash}.txt`);
  console.log(`  user/books/${facts.hash}.contexts.json`);
} catch (e) {
  console.error(`Ошибка: ${(e as Error).message}`);
  process.exit(1);
}