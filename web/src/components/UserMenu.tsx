import { useEffect, useRef, useState } from 'react';
import { api, setApiUser } from '../api';
import './UserMenu.css';

const KEY = 'ankibook.user';
const DEFAULT_USER = 'Default';

/**
 * Цвет плитки выводится из имени, а не хранится.
 *
 * Хранить его значило бы завести вторую сущность рядом с папкой и следить,
 * чтобы они не разошлись. У одного и того же имени плитка всегда одна,
 * на любой машине.
 */
function hash(name: string): number {
  let h = 0;
  for (const ch of name) h = (Math.imul(h, 31) + (ch.codePointAt(0) ?? 0)) | 0;
  return Math.abs(h);
}

/**
 * Цвет берётся из СЕТКИ, а не из непрерывного круга.
 *
 * Свободный тон даёт соседние оттенки: «Default» и «Кеша» разошлись на
 * четырнадцать градусов и оказались одинаково фиолетовыми. Двенадцать шагов
 * по тридцать градусов и две светлоты — двадцать четыре заметно разных
 * плитки; совпадение теперь означает ровно совпадение, а не «почти то же».
 */
const HUES = 12;

function tileColor(name: string): string {
  const h = hash(name);
  return `hsl(${(h % HUES) * (360 / HUES)} 45% ${Math.floor(h / HUES) % 2 ? 38 : 52}%)`;
}

/**
 * Зверёк рисуется DiceBear по имени: то же имя — тот же зверёк.
 *
 * Стиль critters живёт только в 10.x, в 9.x его ещё нет. `tags=animation`
 * добавляет внутрь SVG правила @keyframes — покачивание, моргание, наклон.
 * Они обёрнуты в `prefers-reduced-motion`, так что у тех, кто движение
 * отключил, зверёк просто стоит.
 */
const critter = (name: string) =>
  `https://api.dicebear.com/10.x/critters/svg?tags=animation&seed=${encodeURIComponent(name)}`;

/**
 * Картинка вставляется через <img>, а не разметкой внутрь страницы.
 *
 * SVG со стороннего хоста, положенный в DOM, — это чужой код в твоей
 * странице. В <img> он рисуется, но ничего не выполняет.
 *
 * Сети может не быть: инструмент местный, и он не должен ломаться оттого,
 * что dicebear.com недоступен. Не загрузилось — остаётся плитка с буквой.
 */
function Avatar({ name, size }: { name: string; size: 'sm' | 'md' }) {
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [name]);

  return (
    <span
      className={`avatar avatar--${size}`}
      style={{ background: tileColor(name) }}
      aria-hidden="true"
    >
      {broken ? (
        [...name][0]?.toUpperCase() ?? '?'
      ) : (
        <img className="avatar__img" src={critter(name)} alt="" onError={() => setBroken(true)} />
      )}
    </span>
  );
}

/**
 * Выбор пользователя.
 *
 * Пользователь — это папка в users/. Выбранный помнится в localStorage:
 * он относится к этому браузеру, а не к данным на диске, и сессия мастера
 * тут ни при чём.
 */
export function UserMenu({ user, onChange }: {
  user: string;
  onChange: (name: string) => void;
}) {
  const [users, setUsers] = useState<string[]>([user]);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.listUsers().then((r) => {
      setUsers(r.users);
      // Папку могли удалить руками — способ, который проект сам и предлагает.
      // Тогда в localStorage остаётся имя, которого больше нет; переходим
      // на первого попавшегося, а не показываем несуществующего.
      if (!r.users.includes(user) && r.users.length) onChange(r.users[0]);
    }).catch(() => {});
    // список читается один раз при монтировании
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Клик мимо и Escape закрывают: меню не должно ловить страницу. */
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  const pick = (next: string) => {
    onChange(next);
    setOpen(false);
  };

  async function create() {
    const clean = name.trim();
    if (!clean) return;
    setError(null);
    try {
      const r = await api.createUser(clean);
      setUsers(r.users);
      setName('');
      pick(r.name);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="um" ref={box}>
      <button
        type="button"
        className="um__button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span className="um__name">{user}</span>
        <Avatar name={user} size="sm" />
      </button>

      {open && (
        <div className="um__menu" role="menu">
          <ul className="um__list">
            {users.map((u) => (
              <li key={u}>
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={u === user}
                  className={`um__item${u === user ? ' um__item--on' : ''}`}
                  onClick={() => pick(u)}
                >
                  <Avatar name={u} size="md" />
                  <span className="um__item-name">{u}</span>
                </button>
              </li>
            ))}
          </ul>

          <div className="um__new">
            <input
              className="um__input"
              value={name}
              placeholder="Имя нового"
              maxLength={32}
              onChange={(e) => { setName(e.target.value); setError(null); }}
              onKeyDown={(e) => { if (e.key === 'Enter') void create(); }}
            />
            <button
              type="button"
              className="um__plus"
              onClick={() => void create()}
              disabled={!name.trim()}
              title="Завести пользователя"
              aria-label="Завести пользователя"
            >
              +
            </button>
          </div>
          {error && <p className="um__error">{error}</p>}
        </div>
      )}
    </div>
  );
}

/** Кого выбрали в прошлый раз. Имя чужого браузера сюда не попадёт. */
export function savedUser(): string {
  const name = localStorage.getItem(KEY) ?? DEFAULT_USER;
  setApiUser(name);
  return name;
}

/**
 * Смена пользователя перезагружает страницу.
 *
 * Меняется не одно поле, а всё: книги, словарь, карточки, положение
 * в мастере. Разослать всем экранам «перечитайте себя» можно, но каждый
 * новый экран пришлось бы не забыть подписать — перезагрузка делает это
 * без списка на память.
 */
export function switchUser(name: string): void {
  localStorage.setItem(KEY, name);
  setApiUser(name);
  window.location.reload();
}
