import { generateCards } from '../cards/generate.js';
import { buildQueue, type Pending } from '../cards/queue.js';
import { appendCard, contextsFor, currentUser, loadCards, loadDictionary } from '../library/files.js';
import { llmIfConfigured } from '../llm/index.js';
import { loadSession, updateJob, type JobState } from './session.js';

/**
 * Генерация карточек фоном.
 *
 * Одна задача на процесс: пользователь один, а параллельные прогоны только
 * жгли бы деньги на одних и тех же словах.
 *
 * Прогресс пишется в сессию, то есть на диск, а не в память сервера.
 * Прогон идёт минутами и стоит запроса к модели на карточку — потерять его
 * от обновления вкладки или перезапуска нельзя.
 */
/**
 * Задача на пользователя, а не одна на процесс.
 *
 * Прогон Веры не должен ни мешать прогону Кеши, ни отменяться его кнопкой:
 * данные у них разные, и деньги тоже.
 */
const running = new Map<string, Promise<void>>();
const cancelling = new Set<string>();

export const isRunning = () => running.has(currentUser());

/**
 * Остановить прогон.
 *
 * Два случая, и они разные:
 *
 * 1. Прогон идёт в этом процессе — поднимаем флаг, цикл остановится, дойдя
 *    до следующего слова. Оборвать запрос к модели на полуслове нельзя,
 *    поэтому текущее слово досчитается: это до двух лишних запросов,
 *    зато карточка не останется недоделанной.
 *
 * 2. В файле написано «идёт», а в памяти прогона нет — значит процесс
 *    перезапускали, и задача умерла вместе с ним. Ждать нечего, помечаем
 *    остановленной сразу, иначе экран показывает прогресс вечно.
 *
 * Уже сделанные карточки остаются: они лежат в cards.jsonl и за них
 * заплачено. Остальные слова просто вернутся в очередь.
 */
export function cancelGeneration(): JobState | null {
  const s = loadSession();
  if (!s.job || s.job.status !== 'running') return s.job;

  const user = currentUser();
  if (running.has(user)) {
    cancelling.add(user);
    return s.job;
  }
  return updateJob({ ...s.job, status: 'cancelled' }).job;
}

/** Сколько слов ждёт генерации — для показа перед запуском. */
export function pending(): { total: number; speak: number; read: number } {
  const { todo, speak, read } = buildQueue(loadDictionary(), loadCards());
  return { total: todo.length, speak, read };
}

export class JobBusy extends Error {
  constructor() { super('Генерация уже идёт'); }
}

/**
 * Запускает прогон и СРАЗУ возвращает состояние задачи.
 *
 * Ждать окончания в обработчике запроса нельзя: браузер отвалится по
 * таймауту раньше, чем модель дойдёт до десятой карточки.
 */
export function startGeneration(limit: number): JobState {
  const user = currentUser();
  if (running.has(user)) throw new JobBusy();

  const s = loadSession();
  if (!s.bookHash) throw new Error('Книга не выбрана');

  const llm = llmIfConfigured();
  if (!llm) throw new Error('Нужен ANTHROPIC_API_KEY в окружении сервера');

  const { todo } = buildQueue(loadDictionary(), loadCards());
  const batch = todo.slice(0, limit);
  if (!batch.length) throw new Error('Все отобранные слова уже с карточками');

  const job: JobState = {
    // Времени достаточно: одновременных задач не бывает, а различать надо
    // только «та же самая» от «следующая».
    id: String(Date.now()),
    status: 'running',
    done: 0,
    total: batch.length,
    failed: [],
  };
  updateJob(job);

  const bookHash = s.bookHash;

  cancelling.delete(user);
  running.set(user, (async () => {
    for (const word of batch) {
      if (cancelling.has(user)) break;
      // Примеры берутся из книги прохода, а если слова там нет — из любой,
      // где оно встречалось: в очереди лежат и отобранные раньше.
      await one(llm, word, contextsFor(word.lemma, word.books, bookHash), bookHash, job);
      job.done++;
      updateJob(job);
    }
  })()
    .then(() => { job.status = cancelling.has(user) ? 'cancelled' : 'done'; })
    .catch((e: unknown) => {
      job.status = 'error';
      job.failed.push({ lemma: '—', error: (e as Error).message });
    })
    .finally(() => {
      running.delete(user);
      cancelling.delete(user);
      updateJob(job);
    }));

  return job;
}

/**
 * Одно слово. Ошибка на слове НЕ роняет прогон: сеть моргнула на тридцатом
 * из восьмидесяти — остальные пятьдесят всё равно стоит сделать.
 * Что не получилось, видно в `failed`.
 */
async function one(
  llm: Parameters<typeof generateCards>[0],
  word: Pending,
  contexts: string[],
  bookHash: string,
  job: JobState,
): Promise<void> {
  if (!contexts.length) {
    job.failed.push({ lemma: word.lemma, error: 'нет контекстов в книге' });
    return;
  }
  try {
    const cards = await generateCards(llm, word.lemma, word.pos, contexts, word.deck, bookHash);
    // Пишем по одной, сразу: упасть на середине — потерять одну карточку,
    // а не весь прогон.
    for (const c of cards) appendCard(c);
  } catch (e) {
    job.failed.push({ lemma: word.lemma, error: (e as Error).message.slice(0, 120) });
  }
}
