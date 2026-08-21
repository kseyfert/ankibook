import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { dataDir } from '../config/index.js';

/**
 * Пользователи — это папки.
 *
 * Никакого реестра рядом: список пользователей — то, что лежит в users/,
 * и разойтись с действительностью он не может. Завёл папку руками — она
 * появилась в приложении; удалил — исчезла.
 */
export const USERS_DIR = dataDir;

/** Тот, кто есть всегда: с чего-то начинать надо, а выбирать не из чего. */
export const DEFAULT_USER = 'Default';

/**
 * Имя пользователя — оно же имя папки, оно же значение HTTP-заголовка,
 * оно же аргумент команды в оболочке. Поэтому только то, что нигде
 * не требует экранирования: латиница, цифры, дефис и подчёркивание.
 *
 * Кириллица отпадает не из вредности: заголовки по спецификации latin-1,
 * и «Вера» без процентного кодирования доезжает крокозябрами. Пробел
 * отпадает потому, что `--user My Name` в оболочке пришлось бы брать
 * в кавычки. Слэш и `..` — потому, что это запись за пределы users/,
 * то есть куда угодно в файловой системе.
 */
const NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/;

export const validName = (name: string) => NAME.test(name.trim());

export function userDir(name: string): string {
  if (!validName(name)) throw new Error(`Недопустимое имя пользователя: ${name}`);
  return join(USERS_DIR, name.trim());
}

/**
 * Кто есть. Пусто — заводим Default: пустой список означал бы экран
 * без единого пользователя, а работать под кем-то надо всегда.
 */
export function listUsers(): string[] {
  if (!existsSync(USERS_DIR)) mkdirSync(USERS_DIR, { recursive: true });

  const names = readdirSync(USERS_DIR, { withFileTypes: true })
    // Папку с недопустимым именем не показываем: выбрать её всё равно
    // нельзя — проверка отобьёт её на первом же запросе. Чтобы такая папка
    // вернулась в список, её достаточно переименовать.
    .filter((e) => e.isDirectory() && validName(e.name))
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b, 'ru'));

  if (!names.length) {
    mkdirSync(join(USERS_DIR, DEFAULT_USER), { recursive: true });
    return [DEFAULT_USER];
  }
  return names;
}

/** Заводит пользователя. Уже есть — просто возвращает имя, это не ошибка. */
export function createUser(name: string): string {
  const clean = name.trim();
  if (!validName(clean)) {
    throw new Error('Имя: латиница, цифры, дефис и подчёркивание, до 32 знаков');
  }
  mkdirSync(userDir(clean), { recursive: true });
  return clean;
}
