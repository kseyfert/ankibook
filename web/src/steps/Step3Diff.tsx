import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '../components/Button';
import { RangeSlider } from '../components/RangeSlider';
import { ZipfScale } from '../components/ZipfScale';
import { LineBounds } from '../components/LineBounds';
import { api, type Diff, type DiffWord } from '../api';
import './Step3Diff.css';

/** Сколько строк рисуем за раз. Данные все на клиенте — это только рендер. */
const PAGE = 100;
/**
 * Низ шкалы. Ноль — не «частота ноль», а «слова нет в частотной таблице»:
 * имя собственное, опечатка или совсем экзотика. Отдельного деления такие
 * слова не заслуживают, но и молча пропадать не должны, поэтому стоят
 * на самом краю — и попадают в выборку, только когда край захвачен.
 */
const FLOOR = 0;
/** Низ по умолчанию: ниже единицы осмысленных слов не остаётся. */
const START_LO = 1;
const n = (v: number) => v.toLocaleString('ru-RU');

/** Колонки, по которым сортируем. По умолчанию — вхождения в книге:
 *  это единственная ось, где «больше» однозначно значит «важнее». */
type SortKey = 'checked' | 'lemma' | 'pos' | 'count' | 'zipf';
type Sort = { key: SortKey; dir: 1 | -1 };
const DEFAULT_SORT: Sort = { key: 'count', dir: -1 };

/**
 * Куда колонка сортируется при первом клике.
 *
 * Единого «по убыванию» тут нет: у чисел интересен максимум, у слов —
 * начало алфавита. Одинаковое правило для всех давало бы «Слово ↓» с Z
 * наверху, то есть ровно то, чего никто не ждёт.
 */
const FIRST_DIR: Record<SortKey, 1 | -1> = {
  checked: -1, lemma: 1, pos: 1, count: -1, zipf: -1,
};

function SortHead({ label, sort, mine, onPick, glyph }: {
  label: string;
  sort: Sort;
  mine: SortKey;
  onPick: (key: SortKey) => void;
  /** чем подписать колонку без заголовка — например, графу с галочками */
  glyph?: string;
}) {
  const on = sort.key === mine;
  return (
    <button
      type="button"
      className={`sorthead${on ? ' sorthead--on' : ''}`}
      onClick={() => onPick(mine)}
      title={on ? 'Сменить направление' : `Сортировать по «${label}»`}
      aria-label={glyph ? `Сортировать по «${label}»` : undefined}
    >
      {glyph ?? label}
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
  const [range, setRange] = useState<[number, number]>([START_LO, 4]);
  /** Границы основного текста. Слова, встретившиеся только за ними,
   *  из списка выпадают: лексика лицензии — не лексика книги. */
  const [bounds, setBounds] = useState<[number, number]>([0, 0]);
  /** Снятые галочки. Держим исключения, а не включения: по умолчанию
   *  берём всё, поэтому множество остаётся малым. */
  const [off, setOff] = useState<Set<string>>(new Set());
  const [sort, setSort] = useState<Sort>(DEFAULT_SORT);
  const [shown, setShown] = useState(PAGE);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getDiff(bookHash)
      .then((d) => {
        setDiff(d);
        setRange([START_LO, d.knownZipf]);
        setBounds([d.bounds.start, d.bounds.end]);
        // Прошлый отказ по этой книге. Шаг обратим: слова видны снова,
        // но со снятой галочкой — решение помнится, а не навязывается.
        setOff(new Set(d.excluded));
      })
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

  /**
   * Сколько раз слово встретилось ВНУТРИ выбранных границ.
   *
   * Не общее число вхождений: слово из лицензии Gutenberg встречается
   * двадцать раз, но к книге отношения не имеет. Ноль здесь означает, что
   * слово целиком лежит в служебном блоке, и в словарь ему не надо.
   */
  const counts = useMemo(() => {
    const [from, to] = bounds;
    const m = new Map<string, number>();
    for (const w of diff?.words ?? []) {
      let n = 0;
      for (const l of w.lines) if (l >= from && l <= to) n++;
      m.set(w.lemma, n);
    }
    return m;
  }, [diff, bounds]);

  const countOf = useCallback((w: DiffWord) => counts.get(w.lemma) ?? 0, [counts]);

  const visible = useMemo(
    () => (diff ? diff.words.filter((w) => countOf(w) > 0 && inRange(w)) : []),
    [diff, inRange, countOf],
  );

  /**
   * Сортировка идёт по ВСЕМ словам в диапазоне, а не по нарисованным ста:
   * «показать ещё» — это только рендер, порядок к нему отношения не имеет.
   */
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
      let d: number;
      if (key === 'lemma') d = a.lemma.localeCompare(b.lemma);
      else if (key === 'pos') d = a.posLabel.localeCompare(b.posLabel);
      else if (key === 'checked') d = Number(!off.has(a.lemma)) - Number(!off.has(b.lemma));
      else if (key === 'count') d = countOf(a) - countOf(b);
      else d = a[key] - b[key];
      // Равные значения — по алфавиту: иначе порядок скачет между рендерами.
      return d !== 0 ? d * dir : a.lemma.localeCompare(b.lemma);
    });
  }, [visible, sort, off, countOf]);

  if (error) return <p className="error">{error}</p>;
  if (!diff) return <p className="muted">Считаю изменения…</p>;

  // Отобрано = внутри диапазона и не снято руками. Отклонённое — всё
  // остальное: и снятое галочкой, и отсечённое ползунком.
  const selected = visible.filter((w) => !off.has(w.lemma));
  const keep = new Set(selected.map((w) => w.lemma));
  const dropping = diff.words.filter((w) => !keep.has(w.lemma));
  // Вычитаем только те, для которых эта книга — единственный источник:
  // остальные останутся в словаре по своей второй книге.
  const willShrink = dropping.filter((w) => w.onlyHere).length;
  const page = sorted.slice(0, shown);
  const allShownOn = page.length > 0 && page.every((w) => !off.has(w.lemma));
  // «Все» — это все в диапазоне: за его пределами галочка ничего не значит.
  const allOn = visible.every((w) => !off.has(w.lemma));

  /** Та же колонка — разворот, другая — в своём естественном направлении. */
  const pickSort = (key: SortKey) => {
    setSort((s) => (s.key === key
      ? { key, dir: (s.dir === -1 ? 1 : -1) as 1 | -1 }
      : { key, dir: FIRST_DIR[key] }));
    setShown(PAGE);
  };

  const ariaSort = (key: SortKey) =>
    sort.key === key ? (sort.dir === -1 ? 'descending' : 'ascending') : 'none';

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
      await api.applyDictionary(bookHash, dropping.map((w) => w.lemma));
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
        <div><dt>Не берём</dt><dd className="mono">{n(dropping.length)}</dd></div>
        <div><dt>Станет в словаре</dt><dd className="mono">{n(diff.totalLemmas - willShrink)}</dd></div>
      </dl>

      <LineBounds
        data={diff.bounds}
        value={bounds}
        onChange={(v) => { setBounds(v); setShown(PAGE); }}
      />

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
          max={diff.recordZipf}
          value={range}
          onChange={(v) => { setRange(v); setShown(PAGE); }}
          format={(v) => v.toFixed(1)}
          mark={{ value: diff.knownZipf, title: 'порог знания' }}
        />
      </div>

      <p className="muted diff__counter mono">
        показано {page.length} из {n(visible.length)}
        {visible.length !== diff.words.length && ` (всего ${n(diff.words.length)})`}
      </p>

      {page.length === 0 ? (
        <p className="muted">В этом диапазоне слов нет.</p>
      ) : (
        <table className="wordtable">
          <thead>
          <tr>
            <th className="wordtable__check" aria-sort={ariaSort('checked')}>
              <SortHead label="Отметке" mine="checked" sort={sort} onPick={pickSort} glyph="✓" />
            </th>
            <th className="wordtable__lemma" aria-sort={ariaSort('lemma')}>
              <SortHead label="Слово" mine="lemma" sort={sort} onPick={pickSort} />
            </th>
            <th className="wordtable__pos" aria-sort={ariaSort('pos')}>
              <SortHead label="Часть речи" mine="pos" sort={sort} onPick={pickSort} />
            </th>
            <th className="wordtable__num" aria-sort={ariaSort('count')}>
              <SortHead label="В книге" mine="count" sort={sort} onPick={pickSort} />
            </th>
            <th className="wordtable__scale" aria-sort={ariaSort('zipf')}>
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
                <td className="mono wordtable__num">{countOf(w)}</td>
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
        «В книге» — сколько раз слово встретилось внутри выбранных границ.
        Точка на шкале — насколько слово частотно в языке, штрих — твой порог
        знания ({diff.knownZipf}). Имена собственные и междометия отсеяны
        автоматически. Отказ относится к этой книге: встретится в другой
        и понадобится там — войдёт как новое.
      </p>

      <div className="row">
        <Button variant="primary" onClick={apply} disabled={busy || selected.length === 0}>
          {busy ? 'Применяю…' : `Добавить ${n(selected.length)} слов`}
        </Button>
        <Button variant="quiet" onClick={onBack}>Назад</Button>
      </div>
    </div>
  );
}
