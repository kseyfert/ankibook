import { planExport, runExport } from '../library/export.js';
import { loadCards, loadDictionary, setProcessUser, currentUser } from '../library/files.js';
import { DEFAULT_USER } from '../library/users.js';
import { argStr } from '../config/index.js';

// За кого работаем: `--user Вера`. Без флага — Default.
setProcessUser(argStr('user', DEFAULT_USER));

const cards = loadCards();
if (!cards.length) {
  console.error(`У пользователя ${currentUser()} нет карточек. Сначала: npm run generate`);
  process.exit(1);
}

const plan = planExport(cards);
const dict = loadDictionary();
const { files, skipped } = runExport(plan, dict, new Date().toISOString().slice(0, 10));

for (const f of files) {
  console.log(`${f.deck}: ${f.count} карточек на ${f.lemmas.length} слов → ${f.file}`);
}
if (!files.length) console.log('Нечего выгружать.');

if (skipped.flagged) console.log(`пропущено с замечаниями: ${skipped.flagged}`);
if (skipped.already) console.log(`уже выгружено ранее: ${skipped.already}`);

const waiting = [...dict.values()].filter((d) => d.speak === 'proposed' || d.read === 'proposed').length;
if (waiting) console.log(`ещё ждут карточек: ${waiting} слов`);
