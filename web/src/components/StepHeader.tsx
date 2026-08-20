import './StepHeader.css';

const STEPS = ['Книга', 'Разбор', 'Словарь', 'Отбор', 'Карточки', 'Экспорт'];

/** Нумерация уместна: это действительно последовательность, и порядок
 *  несёт информацию — назад без отката не вернуться. */
export function StepHeader({ current }: { current: number }) {
  return (
    <nav className="steps" aria-label="Этапы">
      {STEPS.map((label, i) => {
        const n = i + 1;
        const state = n < current ? 'done' : n === current ? 'now' : 'todo';
        return (
          <span key={label} className={`steps__item steps__item--${state}`}>
            <span className="steps__num mono">{String(n).padStart(2, '0')}</span>
            {label}
          </span>
        );
      })}
    </nav>
  );
}