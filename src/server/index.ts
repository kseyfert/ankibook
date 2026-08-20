import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { books } from './routes/books.js';
import { session } from './routes/session.js';
import { decisions } from './routes/decisions.js';
import { VersionConflict } from './session.js';
import { rebuild, applyNext } from '../library/rebuild.js';
import { loadProfile, saveExcluded, bookExists } from '../library/files.js';

const app = new Hono();

app.route('/api/books', books);
app.route('/api/session', session);
app.route('/api/decisions', decisions);

/**
 * Применить отбор со шага 3: записать отказы и пересобрать словарь.
 *
 * `excluded` — леммы, с которых снята галочка. Они не попадают в словарь
 * ВООБЩЕ: ни строкой, ни статусом. Решение хранится при книге
 * (`user/books/<hash>.excluded.json`), потому что словарь — производное
 * состояние: пересборка идёт из books/, и решение, оставленное только
 * в словаре, следующая пересборка бы стёрла.
 *
 * Отказ относится к книге, а не к слову навсегда. Придёт из другой книги
 * и там понадобится — войдёт как новое. Вернуться и передумать можно тем же
 * шагом 3: слова, которых нет в словаре, снова окажутся в списке.
 *
 * Порядок обязателен: сначала отказы на диск, потом пересборка. Обратный
 * дал бы словарь, собранный по вчерашнему решению.
 */
app.post('/api/dictionary/apply', async (c) => {
  type Body = { hash?: string; excluded?: string[] };
  const body = await c.req.json<Body>().catch((): Body => ({}));
  if (!body.hash || !bookExists(body.hash)) {
    return c.json({ error: 'Книга не найдена' }, 404);
  }

  saveExcluded(body.hash, body.excluded ?? []);
  const { entries, diff } = rebuild(loadProfile());
  applyNext(entries);

  return c.json({
    total: diff.total,
    added: diff.added.length,
    candidates: diff.candidates,
    excluded: body.excluded?.length ?? 0,
    dropped: diff.dropped.length,
  });
});

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