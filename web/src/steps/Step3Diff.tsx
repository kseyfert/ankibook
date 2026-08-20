import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '../components/Button';
import { RangeSlider } from '../components/RangeSlider';
import { ZipfScale } from '../components/ZipfScale';
import { api, type Diff, type DiffWord } from '../api';
import './Step3Diff.css';

/** Сколько строк рисуем за раз. Данные все на клиенте — это только рендер. */
const PAGE = 100;
const FLOOR = 1;
const CEIL = 7.7;
const n = (v: number) => v.toLocaleString('ru-RU');

/** Колонки, по которым сортируем. По умолчанию — вхождения в книге:
 *  это единственная ось, где «больше» однозначно значит «важнее». */
type SortKey = 'count' | 'zipf';
type Sort = { key: SortKey; dir: 1 | -1 };
const DEFAULT_SORT: Sort = { key: 'count', dir: -1 };

function SortHead({ label, sort, mine, onPick }: {
  label: string;
  sort: Sort;
  mine: SortKey;
  onPick: (key: SortKey) => void;
}) {
  const on = sort.key === mine;
  return (
    <button
      type="button"
      className={`sorthead${on ? ' sorthead--on' : ''}`}
      onClick={() => onPick(mine)}
      title={on ? 'Сменить направление' : `Сортировать по «${label}»`}
    >
      {label}
      <span className="sorthead__arrow" aria-hidden="true">{on ? (sort.dir === -1 ? '↓' : '↑') : ''}</span>
    </button>
  );
}

export function Step3Diff({
                            bookHash, onApplied, onBack,
                          }: {
  bookHash: string;
  onApplied: () => void;
  onBack: () => void;
}) {
  const [diff, setDiff] = useState<Diff | null>(null);
  const [range, setRange] = useState<[number, number]>([FLOOR, 4]);
  /** Снятые галочки. Держим исключения, а не включения: по умолчанию
   *  берём всё, поэтому множество остаётся малым. */
  const [off, setOff] = useState<Set<string>>(new Set());
  const [sort, setSort] = useState<Sort>(DEFAULT_SORT);
  const [shown, setShown] = useState(PAGE);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getDiff(bookHash)
      .then((d) => { setDiff(d); setRange([FLOOR, d.knownZipf]); })
      .catch((e) => setError((e as Error).message));
  }, [bookHash]);

  /**
   * Диапазон — не подсветка списка, а само решение: что вне его, в словарь
   * не идёт. Раньше ползунок прятал строки, но снятыми они не считались,
   * и «Добавить 1080 слов» добавляло ровно 1080 при 629 показанных.
   *
   * zipf === 0 значит «нет в частотной таблице» — имя собственное, опечатка
   * или очень редкое. Такие слова держатся за нижнюю границу: сравнивать
   * отсутствие значения с числом нечем, а молча отклонять их нельзя.
   */
  const inRange = useCallback(
    (w: DiffWord) => (w.zipf === 0 ? range[0] <= FLOOR : w.zipf >= range[0] && w.zipf <= range[1]),
    [range],
  );

  const visible = useMemo(
    () => (diff ? diff.words.filter(inRange) : []),
    [diff, inRange],
  );

  const sorted = useMemo(() => {
    const { key, dir } = sort;
    return [...visible].sort((a, b) => {
      // «Нет в частотной таблице» — не ноль, а отсутствие значения.
      // Сравнивать его с числом нельзя, поэтому такие слова всегда внизу,
      // в обе стороны сортировки.
      if (key === 'zipf' && (a.zipf === 0 || b.zipf === 0)) {
        if (a.zipf === b.zipf) return a.lemma.localeCompare(b.lemma);
        return a.zipf === 0 ? 1 : -1;
      }
      const d = a[key] - b[key];
      // Равные значения — по алфавиту: иначе порядок скачет между рендерами.
      return d !== 0 ? d * dir : a.lemma.localeCompare(b.lemma);
    });
  }, [visible, sort]);

  if (error) return <p className="error">{error}</p>;
  if (!diff) return <p className="muted">Считаю изменения…</p>;

  // Отобрано = внутри диапазона и не снято руками. Отклонённое — всё
  // остальное: и снятое галочкой, и отсечённое ползунком.
  const selected = visible.filter((w) => !off.has(w.lemma));
  const keep = new Set(selected.map((w) => w.lemma));
  const rejectedLemmas = diff.words.filter((w) => !keep.has(w.lemma)).map((w) => w.lemma);
  const page = sorted.slice(0, shown);
  const allShownOn = page.length > 0 && page.every((w) => !off.has(w.lemma));
  // «Все» — это все в диапазоне: за его пределами галочка ничего не значит.
  const allOn = visible.every((w) => !off.has(w.lemma));

  /** Та же колонка — разворот, другая — по убыванию: сверху всегда
   *  «самое-самое», для обеих осей это интереснее начала списка. */
  const pickSort = (key: SortKey) => {
    setSort((s) => (s.key === key ? { key, dir: (s.dir === -1 ? 1 : -1) as 1 | -1 } : { key, dir: -1 }));
    setShown(PAGE);
  };

  const toggle = (lemma: string) =>
    setOff((s) => {
      const next = new Set(s);
      if (next.has(lemma)) next.delete(lemma); else next.add(lemma);
      return next;
    });

  const setMany = (words: DiffWord[], on: boolean) =>
    setOff((s) => {
      const next = new Set(s);
      for (const w of words) { if (on) next.delete(w.lemma); else next.add(w.lemma); }
      return next;
    });

  async function apply() {
    setBusy(true);
    try {
      await api.applyDictionary(rejectedLemmas);
      onApplied();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <h1 className="diff__title">Что добавить в словарь</h1>

      <dl className="facts">
        <div><dt>Новых слов</dt><dd className="mono">{n(diff.words.length)}</dd></div>
        <div><dt>Отобрано</dt><dd className="mono">{n(selected.length)}</dd></div>
        <div><dt>Отклонено</dt><dd className="mono">{n(rejectedLemmas.length)}</dd></div>
        {/* Отклонённые остаются строками словаря — счётчики по ним копятся
            дальше, меняется только статус. Поэтому размер словаря от
            отклонений не зависит. */}
        <div><dt>Станет в словаре</dt><dd className="mono">{n(diff.totalLemmas)}</dd></div>
      </dl>

      <div className="diff__bar">
        <div className="diff__actions">
          <Button variant="quiet" onClick={() => setMany(page, !allShownOn)}>
            {allShownOn ? 'Снять показанные' : 'Отметить показанные'}
          </Button>
          <Button variant="quiet" onClick={() => setMany(visible, !allOn)}>
            {allOn ? 'Снять все в диапазоне' : 'Отметить все в диапазоне'}
          </Button>
        </div>
        <RangeSlider
          label="Популярность"
          min={FLOOR}
          max={CEIL}
          value={range}
          onChange={(v) => { setRange(v); setShown(PAGE); }}
          format={(v) => v.toFixed(1)}
        />
      </div>

      <p className="muted diff__counter mono">
        показано {page.length} из {n(visible.length)}
        {visible.length !== diff.words.length && ` (всего ${n(diff.words.length)})`}
      </p>

      {page.length === 0 ? (
        <p className="muted">В этом диапазоне слов нет. Раздвинь ползунки.</p>
      ) : (
        <table className="wordtable">
          <thead>
          <tr>
            <th className="wordtable__check" />
            <th>Слово</th>
            <th className="wordtable__pos">Часть речи</th>
            <th
              className="wordtable__num"
              aria-sort={sort.key === 'count' ? (sort.dir === -1 ? 'descending' : 'ascending') : 'none'}
            >
              <SortHead label="В книге" mine="count" sort={sort} onPick={pickSort} />
            </th>
            <th
              className="wordtable__scale"
              aria-sort={sort.key === 'zipf' ? (sort.dir === -1 ? 'descending' : 'ascending') : 'none'}
            >
              <SortHead label="Популярность" mine="zipf" sort={sort} onPick={pickSort} />
            </th>
          </tr>
          </thead>
          <tbody>
          {page.map((w) => {
            const on = !off.has(w.lemma);
            return (
              <tr key={w.lemma} className={on ? '' : 'wordtable__row--off'}>
                <td className="wordtable__check">
                  <input type="checkbox" checked={on} onChange={() => toggle(w.lemma)}
                         aria-label={`Добавить ${w.lemma}`} />
                </td>
                <td className="wordtable__lemma">{w.lemma}</td>
                <td className="muted wordtable__pos">{w.posLabel}</td>
                <td className="mono wordtable__num">{w.count}</td>
                <td className="wordtable__scale"><ZipfScale zipf={w.zipf} known={diff.knownZipf} /></td>
              </tr>
            );
          })}
          </tbody>
        </table>
      )}

      {page.length < sorted.length && (
        <div className="row">
          <Button onClick={() => setShown((s) => s + PAGE)}>
            Показать ещё {Math.min(PAGE, sorted.length - page.length)}
          </Button>
        </div>
      )}

      <p className="muted diff__hint">
        Точка на шкале — насколько слово частотно в языке, штрих — твой порог
        знания ({diff.knownZipf}). Имена собственные и междометия отсеяны
        автоматически. Слова, которых нет в частотной таблице, видны только
        когда левый ползунок в самом низу.
      </p>
      {rejectedLemmas.length > 0 && (
        <p className="muted diff__hint">
          {n(rejectedLemmas.length)} слов вне диапазона или со снятой галочкой будут
          отклонены: в словаре они останутся и счётчики по ним продолжат
          копиться, но в карточки предложены не будут. Чтобы оставить запас
          на будущее — раздвинь ползунки.
        </p>
      )}

      <div className="row">
        <Button variant="primary" onClick={apply} disabled={busy || selected.length === 0}>
          {busy ? 'Применяю…' : `Добавить ${n(selected.length)} слов`}
        </Button>
        <Button variant="quiet" onClick={onBack}>Назад</Button>
      </div>
    </div>
  );
}
