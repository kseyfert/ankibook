export { tuning, type Tuning } from './tuning.js';

/**
 * Числовой параметр из аргументов команды: --limit 30
 *
 * Аргументы важнее конфига: они меняются от запуска к запуску, и ради
 * одного прогона редактировать файл неудобно.
 */
export function argNum(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1 || i + 1 >= process.argv.length) return fallback;
  const v = Number(process.argv[i + 1]);
  return Number.isFinite(v) ? v : fallback;
}

/** Флаг присутствия: --apply */
export function argFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}