import type { Bounds } from '../api';
import './LineBounds.css';

/** Пустых строк в тексте половина — разделители абзацев. Молчать про них нельзя. */
const EMPTY = '<пустая строка>';

/**
 * Границы основного текста: где кончается служебный блок.
 *
 * Два независимых ползунка, а не диапазон с двумя ручками: ручки живут
 * в разных концах книги и на общей шкале сошлись бы в одну точку. Шаг —
 * строка, поэтому окно у каждого своё, размером в пару сотен строк.
 *
 * Рядом с номером всегда стоит первое предложение этой строки: номер сам
 * по себе не говорит ничего, а увидев текст, сразу понимаешь, попал ли
 * в начало произведения или ещё в оглавление.
 */
export function LineBounds({ data, value, onChange }: {
  data: Bounds;
  value: [number, number];
  onChange: (v: [number, number]) => void;
}) {
  const [start, end] = value;

  const preview = (n: number): string => {
    const p = n < data.headPreviews.length
      ? data.headPreviews[n]
      : data.tailPreviews[n - data.tailFrom];
    if (p === undefined) return '';
    return p === '' ? EMPTY : p;
  };

  // Ползунки не дают границам разойтись: на короткой книге окна
  // перекрываются, и начало можно было бы утащить за конец.
  const startMax = Math.min(data.headPreviews.length - 1, end);
  const endMin = Math.max(data.tailFrom, start);

  const row = (
    key: 'start' | 'end',
    label: string,
    v: number,
    min: number,
    max: number,
    set: (n: number) => void,
  ) => {
    const empty = preview(v) === EMPTY;
    return (
      <div className="lb__row" key={key}>
        <label className="lb__label" htmlFor={`lb-${key}`}>{label}</label>
        <input
          id={`lb-${key}`}
          type="range"
          className="lb__input"
          min={min}
          max={max}
          step={1}
          value={v}
          disabled={min >= max}
          onChange={(e) => set(Number(e.target.value))}
        />
        <span className="mono lb__num">{v}</span>
        <span className={`lb__preview${empty ? ' lb__preview--empty' : ''}`}>{preview(v)}</span>
      </div>
    );
  };

  return (
    <div className="lb">
      <div className="lb__head">
        <span className="lb__title">Границы текста</span>
        <span className="muted mono lb__total">всего строк {data.lastLine + 1}</span>
      </div>
      {row('start', 'Начало', start, 0, startMax, (n) => onChange([n, end]))}
      {row('end', 'Конец', end, endMin, data.lastLine, (n) => onChange([start, n]))}
    </div>
  );
}
