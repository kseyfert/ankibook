import { createInterface } from 'node:readline';
import { selectCandidates, type Candidate } from '../library/score.js';
import {
  loadDictionary, saveDictionary, loadProfile, listBooks, loadContexts,
  setProcessUser, currentUser,
} from '../library/files.js';
import type { BookContexts, DeckStatus } from '../library/types.js';

import { tuning, argNum } from '../config/index.js';
import { DEFAULT_USER } from '../library/users.js';
import { argStr } from '../config/index.js';

// За кого работаем: `--user Вера`. Без флага — Default.
setProcessUser(argStr('user', DEFAULT_USER));

const TOP_SPEAK = argNum('speak', tuning.review.topSpeak);
const TOP_READ = argNum('read', tuning.review.topRead);
const SHOW_CONTEXTS = tuning.contexts.maxShown;

type Action = 'speak' | 'read' | 'skip' | 'reject' | 'known' | 'back' | 'quit';

const KEYS: Record<string, Action> = {
  s: 'speak', r: 'read', k: 'known', x: 'reject',
  '': 'skip', b: 'back', q: 'quit',
};

function render(c: Candidate, ctx: BookContexts, i: number, total: number): void {
  const d = c.entry;
  console.log(`\n${'─'.repeat(72)}`);
  console.log(`[${i + 1}/${total}]  ${d.lemma}   ${d.pos}`);
  console.log(
    `zipf ${d.zipf || '—'}   в книге ×${c.countInBook}   всего ×${d.totalCount}   книг ${d.bookCount}`,
  );
  if (c.checkSense) {
    console.log(`⚠ встречается в ${Math.round(c.overrepresentation)}× чаще ожидаемого — проверь значение по контекстам`);
  }
  for (const s of (ctx[d.lemma] ?? []).slice(0, SHOW_CONTEXTS)) {
    console.log(`   · ${s.length > 110 ? s.slice(0, 110) + '…' : s}`);
  }
  console.log(`\nпредложено: ${c.suggested.toUpperCase()}  (${c.reason})`);
  console.log('[Enter] принять   s speak   r read   k знаю   x не нужно   b назад   q выход');
}

async function main(): Promise<void> {
  const profile = loadProfile();
  const books = listBooks();
  if (!books.length) {
    console.error(`У пользователя ${currentUser()} нет книг. Сначала: npm run add -- <file>`);
    process.exit(1);
  }
  const book = books[books.length - 1];

  const contexts: BookContexts = loadContexts(book.hash);

  const dict = loadDictionary();
  const cands = selectCandidates(dict, book.hash, book.wordCount, profile, TOP_SPEAK, TOP_READ);

  console.log(`${book.title ?? book.sourceName}`);
  const nSpeak = cands.filter((c) => c.suggested === 'speak').length;
  console.log(`кандидатов к показу: ${cands.length} — speak ${nSpeak}, read ${cands.length - nSpeak}`);

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  let closed = false;
  rl.on('close', () => { closed = true; });
  // На EOF (Ctrl+D, пайп) rl.question не вызывает колбэк никогда —
  // резолвим через событие close, иначе процесс виснет или падает.
  const ask = (q: string) =>
    new Promise<string>((res) => {
      if (closed) return res('q');
      rl.question(q, res);
      rl.once('close', () => res('q'));
    });

  /** Что было выставлено на каждом шаге — для отката по 'b'. */
  const applied: Array<{ lemma: string; speak: DeckStatus; read: DeckStatus }> = [];
  let i = 0;

  while (i < cands.length) {
    const c = cands[i];
    render(c, contexts, i, cands.length);
    const key = (await ask('> ')).trim().toLowerCase();
    const action = KEYS[key];

    if (action === undefined) { console.log('не понял, попробуй ещё'); continue; }
    if (action === 'quit') break;

    if (action === 'back') {
      if (!applied.length) { console.log('это первое слово'); continue; }
      const prev = applied.pop()!;
      const e = dict.get(prev.lemma)!;
      e.speak = prev.speak;
      e.read = prev.read;
      // Решения пишутся на КАЖДОМ шаге: Ctrl+C не должен обнулять работу.
      saveDictionary(dict);
      i--;
      continue;
    }

    const e = dict.get(c.entry.lemma)!;
    applied.push({ lemma: e.lemma, speak: e.speak, read: e.read });

    // proposed, а НЕ accepted: accepted ставится только при экспорте.
    // Иначе сбой между отбором и выгрузкой оставит слово помеченным
    // как добавленное, а карточки не появится — и предложено оно
    // больше никогда не будет.
    const chosen = action === 'skip' ? c.suggested : action;
    if (chosen === 'speak') e.speak = 'proposed';
    else if (chosen === 'read') e.read = 'proposed';
    else if (chosen === 'known') { e.speak = 'known'; e.read = 'known'; }
    else if (chosen === 'reject') { e.speak = 'rejected'; e.read = 'rejected'; }

    saveDictionary(dict);
    i++;
  }

  rl.close();

  const s = { speakQ: 0, readQ: 0, speakDone: 0, readDone: 0, known: 0, rejected: 0 };
  for (const d of dict.values()) {
    if (d.speak === 'proposed') s.speakQ++;
    if (d.read === 'proposed') s.readQ++;
    if (d.speak === 'accepted') s.speakDone++;
    if (d.read === 'accepted') s.readDone++;
    if (d.speak === 'known') s.known++;
    if (d.speak === 'rejected') s.rejected++;
  }
  console.log(`\n${'─'.repeat(72)}`);
  console.log(`просмотрено ${i} из ${cands.length}`);
  console.log(`ждут экспорта: speak ${s.speakQ}, read ${s.readQ}`);
  console.log(`уже выгружено: speak ${s.speakDone}, read ${s.readDone}`);
  console.log(`знаю ${s.known}, не нужно ${s.rejected}`);
}

await main();