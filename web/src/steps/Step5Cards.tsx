import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Button } from '../components/Button';
import { Choice, type Option } from '../components/Choice';
import { IconButton } from '../components/IconButton';
import { api, type CardList, type CardView, type Pending, type Session } from '../api';
import './Step5Cards.css';

const n = (v: number) => v.toLocaleString('ru-RU');

/** Как часто спрашивать сервер, пока идёт прогон. */
const POLL_MS = 1500;

type Size = 'small' | 'medium' | 'all';
const SIZES: Array<Option<Size>> = [
  { value: 'small', label: '10' },
  { value: 'medium', label: '25' },
  { value: 'all', label: 'все' },
];

/** Ожидание ответа на запуск: сколько будет всего, ещё не известно. */
function Starting() {
  return (
    <div className="stack">
      <span className="cards__progress">Запускаю генерацию…</span>
      <div className="bar bar--wait" role="progressbar" aria-label="Запускаю генерацию">
        <div className="bar__fill" />
      </div>
    </div>
  );
}

function Progress({ done, total, onCancel, stopping }: {
  done: number;
  total: number;
  onCancel: () => void;
  stopping: boolean;
}) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  return (
    <div className="stack">
      <div className="row">
        <span className="cards__progress">
          {stopping ? 'Останавливаю…' : 'Генерирую'}{' '}
          <span className="mono">{done}</span> из <span className="mono">{total}</span>
        </span>
        <Button variant="quiet" onClick={onCancel} disabled={stopping}>Отменить</Button>
      </div>
      <div className="bar" role="progressbar" aria-valuenow={done} aria-valuemin={0} aria-valuemax={total}>
        <div className="bar__fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/**
 * Сторона карточки.
 *
 * Рамка в цвет колоды снаружи, светлое поле под текстом внутри — то, что
 * человек увидит при повторении. Подписей «лицо» и «оборот» нет: сторон
 * две, они стоят рядом в известном порядке, и называть их значит объяснять
 * очевидное.
 *
 * Правка идёт на месте, а не в отдельном окне: сравнивать новую версию
 * со второй стороной надо глядя на обе сразу.
 */
function Side({ deck, text, busy, onSave, children }: {
  deck: CardView['deck'];
  text: string;
  busy: boolean;
  onSave: (text: string) => Promise<unknown>;
  children?: ReactNode;
}) {
  const [draft, setDraft] = useState<string | null>(null);

  const save = async () => {
    const value = (draft ?? '').trim();
    // Пустая сторона — не правка, а потеря карточки. Молча выходим.
    if (value && value !== text) await onSave(value);
    setDraft(null);
  };

  return (
    <div className={`side side--${deck}${busy ? ' side--busy' : ''}`}>
      <div className="side__inner">
        {draft === null ? (
          <p className="side__text">{text}</p>
        ) : (
          <textarea
            className="side__edit"
            value={draft}
            autoFocus
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setDraft(null);
              // Enter сохраняет, а не переносит строку: сторона карточки —
              // одна строка текста, перенос в ней всё равно схлопнется.
              if (e.key === 'Enter') { e.preventDefault(); void save(); }
            }}
          />
        )}
      </div>

      <div className="side__tools">
        {draft === null ? (
          <>
            {children}
            <IconButton icon="pencil" label="Править" onClick={() => setDraft(text)} disabled={busy} />
          </>
        ) : (
          <>
            <IconButton icon="cancel" label="Отменить правку" onClick={() => setDraft(null)} />
            <IconButton icon="ok" label="Сохранить" onClick={() => void save()} />
          </>
        )}
      </div>
    </div>
  );
}

function CardRow({ card, onToggle, onChange }: {
  card: CardView;
  onToggle: () => void;
  onChange: (card: CardView) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bad = card.problems.length > 0;

  /** Любое изменение карточки: сервер отвечает новой версией, её и берём. */
  const apply = async (call: Promise<{ card: CardView }>) => {
    setBusy(true);
    setError(null);
    try {
      onChange((await call).card);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className={`card${bad ? ' card--bad' : ''}${card.selected ? '' : ' card--off'}`}>
      <input
        type="checkbox"
        className="card__check"
        checked={card.selected}
        disabled={bad}
        onChange={onToggle}
        aria-label={`Выгружать ${card.lemma}`}
      />
      <div className="card__body">
        <div className="card__head">
          <span className="card__lemma">{card.lemma}</span>
          <span className={`mono card__deck card__deck--${card.deck}`}>{card.deck}</span>
          {/* Значение показывается только у read: на speak-карточке оно уже
              стоит подсказкой внутри самого предложения. */}
          {card.deck === 'read' && card.sense && (
            <span className="muted card__sense">{card.sense}</span>
          )}
          {busy && <span className="muted card__wait">работаю…</span>}
        </div>

        <div className="card__sides">
          <Side deck={card.deck} text={card.front} busy={busy}
                onSave={(front) => apply(api.editCard(card.id, { front }))}>
            {/* Переделать имеет смысл только cloze: у read лицевая сторона —
                само слово, генерировать там нечего. */}
            {card.deck === 'speak' && (
              <IconButton icon="regen" label="Сгенерировать заново" disabled={busy}
                          onClick={() => void apply(api.regenerateCard(card.id))} />
            )}
          </Side>
          <Side deck={card.deck} text={card.back} busy={busy}
                onSave={(back) => apply(api.editCard(card.id, { back }))} />
        </div>

        {error && <p className="error card__problem">{error}</p>}
        {card.problems.map((p) => <p className="card__problem" key={p}>{p}</p>)}
      </div>
    </li>
  );
}

export function Step5Cards({
                             job, onRefresh, onDeselect, onNext, onBack,
                           }: {
  job: Session['job'];
  onRefresh: () => Promise<unknown>;
  onDeselect: (ids: string[]) => Promise<unknown>;
  onNext: () => void;
  onBack: () => void;
}) {
  const [pending, setPending] = useState<Pending | null>(null);
  const [list, setList] = useState<CardList | null>(null);
  const [size, setSize] = useState<Size>('small');
  const [busy, setBusy] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(
    () => Promise.all([api.getPending().then(setPending), api.listCards().then(setList)]),
    [],
  );

  useEffect(() => { reload().catch((e) => setError((e as Error).message)); }, [reload]);

  const running = job?.status === 'running';

  const run = useCallback(async (limit: number) => {
    setBusy(true);
    setError(null);
    setStopping(false);
    try {
      await api.generate(limit);
      await onRefresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [onRefresh]);

  /**
   * Пока идёт прогон, состояние спрашивается опросом.
   *
   * Не поток событий: генерация тянется минутами, за это время вкладку
   * успевают закрыть и открыть заново, и держать соединение ради числа
   * «сделано» дороже, чем спросить раз в полторы секунды.
   */
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => {
      void onRefresh();
      // Список тоже: карточки пишутся на диск по одной, и показывать их
      // разом в конце значит держать человека перед полосой минуту зря.
      void reload().catch(() => {});
    }, POLL_MS);
    return () => clearInterval(t);
  }, [running, onRefresh, reload]);

  /** Прогон закончился — карточки и очередь изменились, перечитываем. */
  const finished = job !== null && job.status !== 'running';
  useEffect(() => {
    if (finished) reload().catch((e) => setError((e as Error).message));
  }, [finished, job?.id, job?.done, reload]);

  /**
   * Первый прогон запускается сам.
   *
   * Пустой экран с одной кнопкой не сообщает ничего: нажать её всё равно
   * придётся. Условие узкое — ни одной карточки, задача не запускалась,
   * очередь непустая. Признак «уже запускали» — сама задача в сессии, она
   * переживает перезагрузку вкладки; поэтому отменённый прогон второй раз
   * сам не стартует и деньги по кругу не жжёт.
   */
  const started = useRef(false);
  useEffect(() => {
    if (started.current || !pending || !list) return;
    if (job !== null || running || list.cards.length > 0 || pending.total === 0) return;
    started.current = true;
    void run(Math.min(pending.autoStart, pending.total));
  });

  if (error) return <p className="error">{error}</p>;
  if (!pending || !list) return <p className="muted">Загружаю…</p>;

  const limit = size === 'all' ? pending.total : size === 'small' ? 10 : 25;
  const count = Math.min(limit, pending.total);

  async function cancel() {
    setStopping(true);
    try {
      await api.cancelJob();
      await onRefresh();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function generate() {
    await run(count);
  }

  const toggle = (card: CardView) => {
    const ids = list.cards.filter((c) => !c.selected).map((c) => c.id);
    const next = card.selected ? [...ids, card.id] : ids.filter((id) => id !== card.id);
    setList({ ...list, cards: list.cards.map((c) => (c.id === card.id ? { ...c, selected: !c.selected } : c)) });
    void onDeselect(next);
  };

  const chosen = list.cards.filter((c) => c.selected && c.problems.length === 0).length;

  /** Панель управления прогоном. Рисуется и над списком, и под ним. */
  const bar = busy && !running ? <Starting /> : running && job ? (
    <Progress done={job.done} total={job.total} onCancel={cancel} stopping={stopping} />
  ) : pending.total > 0 ? (
    <div className="row cards__run">
      <span className="cards__queue">
        В очереди <span className="mono">{n(pending.total)}</span> — speak{' '}
        <span className="mono">{n(pending.speak)}</span>, read{' '}
        <span className="mono">{n(pending.read)}</span>
      </span>
      <Choice options={SIZES} value={size} onChange={setSize} name="Размер прогона" />
      <Button variant="primary" onClick={generate} disabled={busy}>
        {`Сгенерировать ${n(count)}`}
      </Button>
    </div>
  ) : null;

  return (
    <div className="stack">
      <h1 className="cards__title">Карточки</h1>

      {bar}

      {job?.status === 'error' && (
        <p className="error">Прогон оборвался: {job.failed.at(-1)?.error ?? 'неизвестно'}</p>
      )}

      {job && job.failed.length > 0 && job.status !== 'error' && (
        <p className="muted cards__note">
          Без карточки осталось {n(job.failed.length)}:{' '}
          {job.failed.slice(0, 6).map((f) => f.lemma).join(', ')}
          {job.failed.length > 6 && ' …'}. Эти слова остались в очереди — повтори прогон.
        </p>
      )}

      {list.cards.length > 0 && (
        <>
          <ul className="cardlist">
            {list.cards.map((c) => (
              <CardRow
                key={c.id}
                card={c}
                onToggle={() => toggle(c)}
                onChange={(next) => setList({
                  ...list,
                  cards: list.cards.map((x) => (x.id === next.id ? next : x)),
                  clean: list.cards.filter((x) => (x.id === next.id ? next : x).problems.length === 0).length,
                  flagged: list.cards.filter((x) => (x.id === next.id ? next : x).problems.length > 0).length,
                })}
              />
            ))}
          </ul>
          {/* Та же панель снизу: список вырастает на десятки строк, и гонять
              страницу наверх ради следующего прогона — лишняя работа. */}
          {bar}
        </>
      )}

      <div className="row cards__actions">
        <Button variant="primary" onClick={onNext} disabled={running || chosen === 0}>
          Дальше — экспорт ({n(chosen)})
        </Button>
        <Button variant="quiet" onClick={onBack} disabled={running}>Начать заново</Button>
      </div>
    </div>
  );
}
