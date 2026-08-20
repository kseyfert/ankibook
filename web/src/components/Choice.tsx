import './Choice.css';

export interface Option<T extends string> {
  value: T;
  label: string;
  /** Смысловой акцент: колоды окрашены, тупиковые решения — нет. */
  tone?: 'speak' | 'read' | 'plain';
}

/**
 * Переключатель из нескольких взаимоисключающих вариантов.
 *
 * Не select: вариантов четыре, они короткие и выбираются часто — выпадающий
 * список стоил бы два клика вместо одного на каждое слово.
 */
export function Choice<T extends string>({
                                           options, value, onChange, name,
                                         }: {
  options: Array<Option<T>>;
  value: T;
  onChange: (v: T) => void;
  /** Подпись группы для скринридера: без неё четыре кнопки безымянны. */
  name: string;
}) {
  return (
    <div className="choice" role="radiogroup" aria-label={name}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            className={`choice__opt choice__opt--${o.tone ?? 'plain'}${on ? ' choice__opt--on' : ''}`}
            onClick={() => onChange(o.value)}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
