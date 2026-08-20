import './RangeSlider.css';

/**
 * Диапазон с двумя ручками.
 *
 * Нативного двойного range в HTML нет, поэтому два обычных input наложены
 * друг на друга: у каждого прозрачный трек, кликабельна только ручка.
 * Порядок z-index переключается по положению, иначе при сближении ручек
 * верхняя перехватывает клики и нижнюю становится не подцепить.
 */
export function RangeSlider({
                              min, max, step = 0.1, value, onChange, label, format, mark,
                            }: {
  min: number;
  max: number;
  step?: number;
  value: [number, number];
  onChange: (v: [number, number]) => void;
  label: string;
  format?: (v: number) => string;
  /** Опорная точка на шкале: значение само по себе ничего не говорит,
   *  риска показывает, относительно чего его читать. */
  mark?: { value: number; title: string };
}) {
  const [lo, hi] = value;
  const pct = (v: number) => ((v - min) / (max - min)) * 100;
  const show = format ?? ((v: number) => String(v));

  return (
    <div className="range">
      <div className="range__head">
        <span className="range__label">{label}</span>
        <span className="range__value mono">{show(lo)} — {show(hi)}</span>
      </div>
      <div className="range__body">
        <div className="range__track" />
        {mark && mark.value > min && mark.value < max && (
          <span
            className="range__mark"
            style={{ left: `${pct(mark.value)}%` }}
            title={`${mark.title}: ${show(mark.value)}`}
          />
        )}
        <div
          className="range__fill"
          style={{ left: `${pct(lo)}%`, right: `${100 - pct(hi)}%` }}
        />
        <input
          type="range"
          className="range__input range__input--lo"
          min={min} max={max} step={step} value={lo}
          aria-label={`${label}: минимум`}
          onChange={(e) => onChange([Math.min(Number(e.target.value), hi), hi])}
        />
        <input
          type="range"
          className="range__input range__input--hi"
          min={min} max={max} step={step} value={hi}
          aria-label={`${label}: максимум`}
          onChange={(e) => onChange([lo, Math.max(Number(e.target.value), lo)])}
        />
      </div>
    </div>
  );
}