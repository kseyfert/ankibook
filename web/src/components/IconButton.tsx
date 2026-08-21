import './IconButton.css';

/**
 * Иконки нарисованы здесь, а не подключены библиотекой.
 *
 * Их две, обе в десяток команд пути. Тянуть ради этого зависимость значит
 * добавить в сборку сотни килобайт и ещё одну вещь, которая может отстать
 * от версии React.
 */
const PATHS = {
  /** Карандаш — правка от руки. */
  pencil: (
    <>
      <path d="M2 14l.9-3.2L10.6 3l2.4 2.4-7.7 7.7L2 14z" />
      <path d="M9.6 4l2.4 2.4" />
    </>
  ),
  /** Круговая стрелка — сделать заново. */
  regen: (
    <>
      <path d="M13.2 8a5.2 5.2 0 1 1-1.5-3.7" />
      <path d="M13.4 2.2v3h-3" />
    </>
  ),
  /** Галочка — сохранить правку. */
  ok: <path d="M3 8.4l3.2 3.2L13 4.8" />,
  /** Стрелка вниз в поддон — скачать файл. */
  download: (
    <>
      <path d="M8 2v8" />
      <path d="M4.5 6.8L8 10.3l3.5-3.5" />
      <path d="M2.5 13.2h11" />
    </>
  ),
  /** Два листа — скопировать текст. */
  copy: (
    <>
      <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
      <path d="M10.5 3.5h-7a1.5 1.5 0 0 0-1.5 1.5v7" />
    </>
  ),
  /** Крест — отказаться от правки. */
  cancel: (
    <>
      <path d="M4 4l8 8" />
      <path d="M12 4l-8 8" />
    </>
  ),
} as const;

export function IconButton({ icon, label, onClick, disabled }: {
  icon: keyof typeof PATHS;
  /** Что кнопка делает: она без подписи, и без этого её не прочитать. */
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button type="button" className="iconbtn" onClick={onClick} disabled={disabled}
            title={label} aria-label={label}>
      <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"
           fill="none" stroke="currentColor" strokeWidth="1.4"
           strokeLinecap="round" strokeLinejoin="round">
        {PATHS[icon]}
      </svg>
    </button>
  );
}
