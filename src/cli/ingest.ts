import { writeFileSync } from 'node:fs';
import { ingest } from '../text/ingest.js';

const [path, out] = process.argv.slice(2);
if (!path) {
  console.error('usage: npm run ingest -- <file> [out.txt]');
  process.exit(1);
}

const doc = await ingest(path);
console.error(`${doc.meta.title ?? '?'} — ${doc.meta.author ?? '?'}`);
console.error(`формат: ${doc.meta.format}   слов: ${doc.meta.wordCount}   символов: ${doc.meta.charCount}`);
if (doc.warnings.length) console.error('warnings:\n  ' + doc.warnings.join('\n  '));

if (out) writeFileSync(out, doc.text);
else process.stdout.write(doc.text.slice(0, 400) + '\n...\n');