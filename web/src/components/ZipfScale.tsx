import './ZipfScale.css';

/**
 * Подпись проекта: логарифмическая шкала частотности.
 *
 * Весь отбор держится на zipf, но само число ничего не говорит без опоры.
 * Шкала показывает, где слово стоит между служебным и экзотикой, и где
 * проходит твой порог знания.
 */
export function ZipfScale({ zipf, known }: { zipf: number; known: number }) {
  const MIN = 2, MAX = 6;
  const pct = (v: number) => ((Math.min(MAX, Math.max(MIN, v)) - MIN) / (MAX - MIN)) * 100;
  return (
    <span className="zscale" title={`zipf ${zipf || '—'}, порог знания ${known}`}>
      <span className="zscale__track" />
      <span className="zscale__known" style={{ left: `${pct(known)}%` }} />
      {zipf > 0 && <span className="zscale__dot" style={{ left: `${pct(zipf)}%` }} />}
    </span>
  );
}