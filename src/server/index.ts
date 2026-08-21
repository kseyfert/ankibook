import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';
import { books } from './routes/books.js';
import { session } from './routes/session.js';
import { decisions } from './routes/decisions.js';
import { cards } from './routes/cards.js';
import { exports } from './routes/export.js';
import { users } from './routes/users.js';
import { VersionConflict } from './session.js';
import { rebuild, applyNext } from '../library/rebuild.js';
import { runAsUser } from '../library/files.js';
import { DEFAULT_USER, validName } from '../library/users.js';
import { loadProfile, saveExcluded, bookExists } from '../library/files.js';

const app = new Hono();

/**
 * Кто пришёл — из заголовка, а не из состояния сервера.
 *
 * Сервер про «текущего пользователя» ничего не помнит: помнит браузер,
 * и присылает с каждым запросом. Иначе две вкладки под разными людьми
 * дрались бы за одну переменную, а перезапуск сервера терял бы, кто есть кто.
 *
 * Имя идёт в путь к папке, поэтому проверяется здесь же: `..` или слэш
 * означали бы чтение и запись мимо users/. Экранирования не нужно —
 * допустимы только латиница, цифры, дефис и подчёркивание.
 */
app.use('/api/*', async (c, next) => {
  const name = c.req.header('x-user')?.trim() || DEFAULT_USER;
  if (!validName(name)) return c.json({ error: `Недопустимое имя пользователя: ${name}` }, 400);
  return runAsUser(name, next);
});

app.route('/api/books', books);
app.route('/api/session', session);
app.route('/api/decisions', decisions);
app.route('/api/cards', cards);
app.route('/api/export', exports);
app.route('/api/users', users);

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

/**
 * Собранный фронт отдаёт сам сервер.
 *
 * В разработке статику раздаёт vite и он же проксирует /api — двух портов
 * там не жалко. Снаружи два порта означали бы либо второй туннель, либо
 * веб-сервер перед ними; проще отдавать всё одним процессом.
 *
 * Путь считается от файла сервера, а не от текущей директории: и `src/`,
 * и собранный `dist/` лежат на два уровня ниже корня, так что выражение
 * одно на оба случая. serveStatic ждёт путь относительно cwd — приводим.
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const WEB = join(HERE, '..', '..', 'web', 'dist');

if (existsSync(WEB)) {
  const root = relative(process.cwd(), WEB) || '.';
  app.use('/*', serveStatic({ root }));
  // Мастер — одна страница: любой неизвестный путь отдаёт её, а не 404.
  app.get('*', serveStatic({ path: join(root, 'index.html') }));
} else {
  console.warn(`Фронт не собран (${WEB} нет). Только API. Сборка: npm run build`);
}


/**
 * Слушаем петлю, а не все интерфейсы.
 *
 * Наружу приложение выходит через туннель Cloudflare, который подключается
 * с этой же машины. Открытый порт на публичном адресе означал бы вход
 * в обход Zero Trust — то есть без всякой проверки, кто пришёл.
 */
const port = Number(process.env.PORT ?? 3001);
const hostname = process.env.HOST ?? '127.0.0.1';
serve({ fetch: app.fetch, port, hostname });
console.log(`AnkiBook на http://${hostname}:${port}`);