import { unlinkSync } from 'node:fs';
import { rebuild, writeNext, applyNext, nextPath, hasNext } from '../library/rebuild.js';
import { loadProfile } from '../library/files.js';
import { argFlag } from '../config/index.js';

import { setProcessUser } from '../library/files.js';
import { DEFAULT_USER } from '../library/users.js';
import { argStr } from '../config/index.js';

// За кого работаем: `--user Вера`. Без флага — Default.
setProcessUser(argStr('user', DEFAULT_USER));

const apply = argFlag('apply');
const profile = loadProfile();
const { entries, diff } = rebuild(profile);

console.log(`книг: ${diff.books}   лемм в словаре: ${diff.total}`);
console.log(`порог знания zipf < ${profile.knownZipf}   порог записи zipf < ${profile.recordZipf}\n`);

console.log(`новых лемм:        ${diff.added.length}`);
if (diff.added.length) console.log('  ' + diff.added.slice(0, 12).join(', ') + (diff.added.length > 12 ? ' …' : ''));

console.log(`выросло bookCount: ${diff.bookCountUp.length}`);
for (const b of diff.bookCountUp.slice(0, 10)) console.log(`  ${b.lemma}: ${b.from} → ${b.to} книг`);

if (diff.excluded) {
  console.log(`не взято:          ${diff.excluded} слов (отказ на отборе)`);
}

if (diff.orphaned.length) {
  console.log(`осиротело:         ${diff.orphaned.length} (книга удалена, статус сохранён)`);
  console.log('  ' + diff.orphaned.slice(0, 10).join(', '));
}

if (diff.dropped.length) {
  console.log(`выброшено:         ${diff.dropped.length} (без решений и без источников)`);
  console.log('  ' + diff.dropped.slice(0, 10).join(', ') + (diff.dropped.length > 10 ? ' …' : ''));
}

console.log(`\nкандидатов к отбору: ${diff.candidates}`);

if (apply) {
  applyNext(entries);
  if (hasNext()) unlinkSync(nextPath());
  console.log('\ndictionary.jsonl обновлён.');
} else {
  writeNext(entries);
  console.log(`\nзаписано в ${nextPath()}`);
  console.log('основной словарь не тронут; для применения: npm run rebuild -- --apply');
}