import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { books } from './routes/books.js';
import { session } from './routes/session.js';
import { decisions } from './routes/decisions.js';
import { VersionConflict } from './session.js';
import { rebuild, applyNext } from '../library/rebuild.js';
import { loadProfile, loadDictionary, saveDictionary } from '../library/files.js';

const app = new Hono();

app.route('/api/books', books);
app.route('/api/session', session);
app.route('/api/decisions', decisions);

/**
 * Применить пересборку словаря — подтверждение на шаге 3.
 *
 * `rejected` — леммы, с которых снята галочка. Отдельного файла исключений
 * нет: словарь пересобирается из books/ детерминированно, поэтому решение
 * должно жить в самом словаре, иначе следующая пересборка вернёт слово.
 * Статус rejected для этого и существует.
 */
app.post('/api/dictionary/apply', async (c) => {
  const body = await c.req.json<{ rejected?: string[] }>().catch(() => ({ rejected: [] }));
  const { entries, diff } = rebuild(loadProfile());
  applyNext(entries);

  if (body.rejected?.length) {
    const dict = loadDictionary();
    for (const lemma of body.rejected) {
      const d = dict.get(lemma);
      if (d) { d.speak = 'rejected'; d.read = 'rejected'; }
    }
    saveDictionary(dict);
  }

  return c.json({
    total: diff.total,
    added: diff.added.length,
    candidates: diff.candidates,
    rejected: body.rejected?.length ?? 0,
  });
});

/**
 * Расхождение версий обрабатывается здесь, а не в каждом роуте: проверка
 * стоит перед любой мутацией, и try/catch вокруг каждой из них — это шум,
 * который рано или поздно где-нибудь забудут написать.
 */
app.onError((err, c) => {
  if (err instanceof VersionConflict) {
    return c.json({ error: err.message, session: err.current }, 409);
  }
  console.error(err);
  return c.json({ error: err.message }, 500);
});

const port = Number(process.env.PORT ?? 3001);
serve({ fetch: app.fetch, port });
console.log(`API на http://localhost:${port}`);