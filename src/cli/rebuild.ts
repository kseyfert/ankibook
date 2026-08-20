import { unlinkSync } from 'node:fs';
import { rebuild, writeNext, applyNext, NEXT_PATH, hasNext } from '../library/rebuild.js';
import { loadProfile } from '../library/files.js';
import { argFlag } from '../config/index.js';

const apply = argFlag('apply');
const profile = loadProfile();
const { entries, diff } = rebuild(profile);

console.log(`книг: ${diff.books}   лемм в словаре: ${diff.total}`);
console.log(`порог знания zipf < ${profile.knownZipf}   порог записи zipf < ${profile.recordZipf}\n`);

console.log(`новых лемм:        ${diff.added.length}`);
if (diff.added.length) console.log('  ' + diff.added.slice(0, 12).join(', ') + (diff.added.length > 12 ? ' …' : ''));

console.log(`выросло bookCount: ${diff.bookCountUp.length}`);
for (const b of diff.bookCountUp.slice(0, 10)) console.log(`  ${b.lemma}: ${b.from} → ${b.to} книг`);

if (diff.orphaned.length) {
  console.log(`осиротело:         ${diff.orphaned.length} (книга удалена, статус сохранён)`);
  console.log('  ' + diff.orphaned.slice(0, 10).join(', '));
}

console.log(`\nкандидатов к отбору: ${diff.candidates}`);

if (apply) {
  applyNext(entries);
  if (hasNext()) unlinkSync(NEXT_PATH);
  console.log('\ndictionary.jsonl обновлён.');
} else {
  writeNext(entries);
  console.log(`\nзаписано в ${NEXT_PATH}`);
  console.log('основной словарь не тронут; для применения: npm run rebuild -- --apply');
}