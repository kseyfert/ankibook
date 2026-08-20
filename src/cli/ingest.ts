import { writeFileSync } from 'node:fs';
import { ingest } from '../text/ingest.js';
import { llmIfConfigured } from '../llm/index.js';

const [path, out] = process.argv.slice(2);
if (!path) {
  console.error('usage: npm run ingest -- <file> [out.txt]');
  process.exit(1);
}

// Команда служебная — показать, что извлеклось из файла. Модель нужна
// только для границ, и без ключа они просто будут крайними.
const doc = await ingest(path, llmIfConfigured());
console.error(`${doc.meta.title ?? '?'} — ${doc.meta.author ?? '?'}`);
console.error(`формат: ${doc.meta.format}   слов: ${doc.meta.wordCount}   символов: ${doc.meta.charCount}`);
console.error(`основной текст: строки ${doc.meta.expectedStartLine}–${doc.meta.expectedEndLine}`);
if (doc.warnings.length) console.error('warnings:\n  ' + doc.warnings.join('\n  '));

if (out) writeFileSync(out, doc.text);
else process.stdout.write(doc.text.slice(0, 400) + '\n...\n');