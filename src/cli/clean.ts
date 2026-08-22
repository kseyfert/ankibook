import { readdirSync, rmSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { userDir, booksDir, exportsDir, currentUser, setProcessUser } from '../library/files.js';
import { DEFAULT_USER, listUsers, userDir as dirOf } from '../library/users.js';
import { argStr } from '../config/index.js';

// За кого работаем: `--user Вера`. Без флага — Default.
setProcessUser(argStr('user', DEFAULT_USER));

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

const files = scan(userDir());

if (!files.length) {
  // Кто именно пуст — важнее самого факта. Команда без флага берёт Default,
  // и «данных нет» на чужой папке выглядит как пропажа данных.
  console.log(`У пользователя ${currentUser()} данных нет, чистить нечего.`);

  const others = listUsers()
    .filter((name) => name !== currentUser() && scan(dirOf(name)).length > 0);
  if (others.length) {
    console.log(`\nДанные есть у: ${others.join(', ')}`);
    console.log(`Чистить конкретного: npm run clean -- --user ${others[0]}`);
  }
  process.exit(0);
}

const size = files.reduce((n, f) => n + statSync(f).size, 0);
const group = (dir: string) => files.filter((f) => f.startsWith(dir + '/')).length;

console.log(`Будет удалено у пользователя ${currentUser()}:`);
console.log(`  книг и текстов:  ${group(booksDir())} файлов`);
console.log(`  выгрузок:        ${group(exportsDir())} файлов`);
console.log(`  в корне папки:   ${files.length - group(booksDir()) - group(exportsDir())} файлов`);
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