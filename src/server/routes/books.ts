import { Hono } from 'hono';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { addBook } from '../../library/add-book.js';
import {
  listBooks, loadBookText, loadContexts, loadDictionary, loadExcluded, loadProfile,
} from '../../library/files.js';
import { rebuild, NO_EXCLUSIONS } from '../../library/rebuild.js';
import { isEligible, selectCandidates, type Candidate } from '../../library/score.js';
import { loadSession, saveSession } from '../session.js';
import { posShort } from '../../library/pos.js';
import { llmIfConfigured } from '../../llm/index.js';
import { tuning } from '../../config/index.js';
import { lineIndexer, lineWindows } from '../../text/lines.js';

export const books = new Hono();

/** Список книг с тем, что нужно для выбора на шаге 1. */
books.get('/', (c) => {
  const dict = loadDictionary();
  return c.json(
    listBooks().map((b) => {
      const mine = [...dict.values()].filter((d) => (d.books[b.hash] ?? 0) > 0);
      return {
        hash: b.hash,
        title: b.title,
        author: b.author,
        sourceName: b.sourceName,
        addedAt: b.addedAt,
        wordCount: b.wordCount,
        /** сколько лемм книги ты решил взять в словарь */
        inDictionary: mine.length,
        /**
         * Сколько уже уехало в Noji.
         *
         * Статус стоит на СЛОВЕ, а не на книге, поэтому слово, выгруженное
         * вместе с другой книгой, посчитается и здесь. Так и надо: вопрос
         * «сколько из этой книги я уже прошёл», а не «сколько выгрузил
         * именно этим проходом».
         */
        exported: mine.filter((d) => d.speak === 'accepted' || d.read === 'accepted').length,
      };
    }),
  );
});

/** Загрузка файла книги. */
books.post('/', async (c) => {
  const form = await c.req.formData();
  const file = form.get('file');
  if (!(file instanceof File)) {
    return c.json({ error: 'Прикрепи файл книги' }, 400);
  }

  const dir = mkdtempSync(join(tmpdir(), 'vocabmine-'));
  const path = join(dir, file.name);
  writeFileSync(path, Buffer.from(await file.arrayBuffer()));

  try {
    const { facts, contextCount } = await addBook(path, llmIfConfigured());
    const s = loadSession();
    const next = saveSession({ ...s, step: 3, bookHash: facts.hash, decisions: {}, deselected: [] });
    return c.json({
      book: {
        hash: facts.hash,
        title: facts.title,
        author: facts.author,
        sourceName: facts.sourceName,
        wordCount: facts.wordCount,
        charCount: facts.charCount,
        lemmaCount: facts.entries.length,
        contextCount,
        expectedStartLine: facts.expectedStartLine,
        expectedEndLine: facts.expectedEndLine,
      },
      session: next,
    });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 400);
  }
});

/**
 * Что добавится в словарь. Только чтение, на диск ничего не пишет.
 *
 * Отдаём ВСЕ слова разом, без пагинации: их порядка тысячи, это десятки
 * килобайт. Зато фильтр по частотности и «отметить всё» работают мгновенно
 * на клиенте, без похода на сервер за каждым изменением ползунка.
 *
 * Пересборка считается БЕЗ учёта прошлых отказов, а сами отказы едут рядом
 * списком. Так шаг 3 остаётся обратимым: вернувшись, ты снова видишь то, от
 * чего отказался, — со снятой галочкой. Считай мы по сохранённому решению,
 * отказанное слово просто исчезло бы из списка, и передумать было бы негде.
 */
books.get('/:hash/diff', (c) => {
  const hash = c.req.param('hash');
  const book = listBooks().find((b) => b.hash === hash);
  if (!book) return c.json({ error: 'Книга не найдена' }, 404);

  const profile = loadProfile();
  const { entries, diff } = rebuild(profile, NO_EXCLUSIONS);
  const excluded = loadExcluded(hash);

  // Превью строк для ручной правки границ. Отдаём вместе с diff, а не
  // отдельным запросом на строку: ползунок должен отзываться на каждое
  // деление, а поход на сервер за каждым тиком этого не даёт.
  const text = loadBookText(hash);
  const win = lineWindows(
    text,
    tuning.bookBounds.adjustLines,
    book.expectedStartLine,
    book.expectedEndLine,
  );

  // Строки, в которых слово встретилось. Позиции лежат в фактах книги
  // в символах — переводим один раз здесь, чтобы клиент фильтровал
  // ползунком мгновенно, не спрашивая сервер на каждое деление.
  const toLine = lineIndexer(text);
  const occurrences = new Map(book.entries.map((e) => [e.lemma, e.occurrences]));

  const newOnes = diff.added
    .map((l) => entries.get(l)!)
    .filter((d) => (d.books[hash] ?? 0) > 0)
    .sort((a, b) => (b.books[hash] ?? 0) - (a.books[hash] ?? 0));

  return c.json({
    book: { hash: book.hash, title: book.title, wordCount: book.wordCount },
    totalLemmas: diff.total,
    added: newOnes.length,
    bookCountUp: diff.bookCountUp.length,
    knownZipf: profile.knownZipf,
    recordZipf: profile.recordZipf,
    /** прошлый отказ по этой книге — галочки снимутся сами */
    excluded: [...excluded],
    /**
     * Границы основного текста: предположение модели плюс окна, в которых
     * его можно подвинуть. Ничего не обрезано — текст сохранён целиком.
     */
    bounds: {
      start: book.expectedStartLine,
      end: book.expectedEndLine,
      lastLine: win.lastLine,
      headPreviews: win.head,
      tailFrom: win.tailFrom,
      tailPreviews: win.tail,
    },
    words: newOnes.map((d) => ({
      lemma: d.lemma,
      pos: d.pos,
      posLabel: posShort(d.pos),
      zipf: d.zipf,
      // Номер строки на каждое вхождение, а не список уникальных строк:
      // в абзаце слово может стоять дважды, и для счётчика это два раза.
      lines: (occurrences.get(d.lemma) ?? []).map(toLine),
      // Единственный источник — значит отказ убирает лемму из словаря
      // целиком. Есть другая книга — строка останется, и вычитать её
      // из «станет в словаре» нельзя.
      onlyHere: Object.keys(d.books).length === 1,
    })),
  });
});

/**
 * Кандидаты к отбору для шага 4.
 *
 * Топ берётся ПО КАЖДОЙ КОЛОДЕ ОТДЕЛЬНО — формулы приоритета у них разные,
 * и общий топ вымывает read-лексику (см. selectCandidates). Поэтому лимиты
 * тоже раздельные, а не одно число на двоих.
 *
 * Отдаём порцию, а не всё разом (в отличие от шага 3): к каждому слову идут
 * примеры предложений, и на тысяче кандидатов ответ вырос бы до мегабайтов.
 * Остаток виден в `remaining` — за ним возвращаются следующим проходом.
 */
books.get('/:hash/candidates', (c) => {
  const hash = c.req.param('hash');
  const book = listBooks().find((b) => b.hash === hash);
  if (!book) return c.json({ error: 'Книга не найдена' }, 404);

  const num = (v: string | undefined, fallback: number) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? Math.min(n, 500) : fallback;
  };
  const topSpeak = num(c.req.query('speak'), tuning.review.topSpeak);
  const topRead = num(c.req.query('read'), tuning.review.topRead);

  const profile = loadProfile();
  const dict = loadDictionary();
  const contexts = loadContexts(hash);
  const picked = selectCandidates(dict, hash, book.wordCount, profile, topSpeak, topRead);

  const eligible = [...dict.values()].filter(
    (d) => isEligible(d, profile) && (d.books[hash] ?? 0) > 0,
  ).length;

  const word = (cand: Candidate) => ({
    lemma: cand.entry.lemma,
    pos: cand.entry.pos,
    posLabel: posShort(cand.entry.pos),
    zipf: cand.entry.zipf,
    countInBook: cand.countInBook,
    totalCount: cand.entry.totalCount,
    bookCount: cand.entry.bookCount,
    suggested: cand.suggested,
    reason: cand.reason,
    checkSense: cand.checkSense,
    // Infinity в JSON превращается в null — округляем здесь, а не на клиенте.
    overrepresentation: Number.isFinite(cand.overrepresentation)
      ? Math.round(cand.overrepresentation)
      : null,
    contexts: (contexts[cand.entry.lemma] ?? []).slice(0, tuning.contexts.maxShown),
  });

  return c.json({
    book: { hash: book.hash, title: book.title, wordCount: book.wordCount },
    knownZipf: profile.knownZipf,
    eligible,
    remaining: Math.max(0, eligible - picked.length),
    limits: { speak: topSpeak, read: topRead },
    words: {
      speak: picked.filter((x) => x.suggested === 'speak').map(word),
      read: picked.filter((x) => x.suggested === 'read').map(word),
    },
  });
});
