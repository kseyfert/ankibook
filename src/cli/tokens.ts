import { tokenize } from '../text/tokenize.js';

const text = process.argv.slice(2).join(' ');
if (!text) {
  console.error('usage: npm run tok -- "He saw the fish."');
  process.exit(1);
}

const toks = tokenize(text);

console.log(`${'ПОЗ'.padStart(5)}  ${'ФОРМА'.padEnd(14)}${'ЛЕММА'.padEnd(14)}POS`);
for (const t of toks) {
  if (t.pos === 'SPACE') continue;
  const changed = t.lemma !== t.form.toLowerCase() ? ' ←' : '';
  console.log(
    `${String(t.start).padStart(5)}  ${t.form.padEnd(14)}${t.lemma.padEnd(14)}${t.pos}${changed}`,
  );
}

// инвариант: позиция указывает ровно на форму
const bad = toks.filter((t) => text.slice(t.start, t.start + t.form.length) !== t.form);
console.log(`\nтокенов: ${toks.length}   позиции: ${bad.length === 0 ? 'ok' : 'ОШИБОК ' + bad.length}`);