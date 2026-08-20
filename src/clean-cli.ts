import { readdirSync, rmSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { USER_DIR, BOOKS_DIR, EXPORTS_DIR } from './store/files.js';

/** Что сохраняем: .gitkeep держит структуру папок в репозитории. */
const KEEP = new Set(['.gitkeep']);

function scan(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (KEEP.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...scan(p));
    else out.push(p);
  }
  return out;
}

const files = scan(USER_DIR);

if (!files.length) {
  console.log('Данных нет, чистить нечего.');
  process.exit(0);
}

const size = files.reduce((n, f) => n + statSync(f).size, 0);
const group = (dir: string) => files.filter((f) => f.startsWith(dir + '/')).length;

console.log('Будет удалено:');
console.log(`  книг и текстов:  ${group(BOOKS_DIR)} файлов`);
console.log(`  выгрузок:        ${group(EXPORTS_DIR)} файлов`);
console.log(`  в корне user/:   ${files.length - group(BOOKS_DIR) - group(EXPORTS_DIR)} файлов`);
console.log(`  итого:           ${files.length} файлов, ${(size / 1024 / 1024).toFixed(1)} МБ`);
console.log('\nСловарь, статусы слов, карточки и журнал выгрузок будут потеряны.');
console.log('Восстановить нельзя. Слова, уже уехавшие в Noji, там и останутся,');
console.log('но система про них забудет и предложит заново.');

const rl = createInterface({ input: process.stdin, output: process.stdout });
rl.question('\nВведи "clean" для подтверждения: ', (answer) => {
  rl.close();
  if (answer.trim() !== 'clean') {
    console.log('Отменено, ничего не удалено.');
    process.exit(0);
  }
  for (const f of files) rmSync(f, { force: true });
  // пустые подпапки, кроме тех, что держим через .gitkeep
  console.log(`Удалено ${files.length} файлов. Можно начинать с чистого листа.`);
});