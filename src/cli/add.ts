import { addBook } from '../library/add-book.js';
import { llmIfConfigured } from '../llm/index.js';

import { setProcessUser } from '../library/files.js';
import { DEFAULT_USER } from '../library/users.js';
import { argStr } from '../config/index.js';

// За кого работаем: `--user Вера`. Без флага — Default.
setProcessUser(argStr('user', DEFAULT_USER));

// Первый аргумент, который не флаг и не его значение: `--user` может
// стоять и перед путём к книге.
const rest = process.argv.slice(2);
const flag = rest.indexOf('--user');
const path = rest.filter((_, i) => i !== flag && i !== flag + 1)[0];
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