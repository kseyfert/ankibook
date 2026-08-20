/**
 * Строки книги и их превью — для ручной правки границ основного текста.
 *
 * Номер строки сам по себе человеку ничего не говорит: чтобы понять, что
 * стоит на 2832-й, надо её увидеть. Модуль готовит короткие подписи к тем
 * строкам, по которым вообще можно двигать границу.
 */

import { tuning } from '../config/index.js';

/**
 * Слишком короткий кусок до точки — это сокращение, а не предложение.
 * «Mr.», «St.», «No.» показали бы пустоту вместо ориентира, поэтому
 * до двадцати знаков точку за конец предложения не считаем.
 *
 * В конфиг не вынесено намеренно: крутить тут нечего. Это правило разбора
 * сокращений, у него нет положения «лучше» или «хуже» под конкретного
 * человека — в отличие от длины превью, которая зависит от того, сколько
 * ты готов везти по сети.
 */
const MIN_SENTENCE = 20;

/** Первое предложение строки. Пустая строка — пустой результат. */
export function firstSentence(line: string, max = tuning.bookBounds.previewChars): string {
  const s = line.replace(/\s+/g, ' ').trim();
  if (!s) return '';

  let end = s.length;
  const stop = /[.!?](?:\s|$)/g;
  for (let m = stop.exec(s); m; m = stop.exec(s)) {
    if (m.index + 1 >= MIN_SENTENCE) { end = m.index + 1; break; }
  }

  const out = s.slice(0, end);
  if (out.length <= max) return out;
  // Режем по границе слова: оборванное слово читается как опечатка.
  const space = out.lastIndexOf(' ', max);
  return (space > max / 2 ? out.slice(0, space) : out.slice(0, max)).trimEnd() + '…';
}

export interface LineWindows {
  /** номер последней строки файла */
  lastLine: number;
  /** превью строк 0…head.length-1 */
  head: string[];
  /** номер строки, которой соответствует tail[0] */
  tailFrom: number;
  tail: string[];
}

/**
 * Окна, в которых границу можно двигать руками.
 *
 * Не весь файл: в книге тысячи строк, а служебный блок лежит по краям —
 * ползунок на три тысячи делений с шагом в строку невозможно навести.
 *
 * Окно обязано вмещать предположение модели, даже если оно дальше `adjust`
 * строк от края: иначе ползунок не смог бы показать собственное начальное
 * значение и молча сдвинул бы границу при первом же рендере.
 */
export function lineWindows(
  text: string,
  adjust: number,
  start: number,
  end: number,
): LineWindows {
  const lines = text.split('\n');
  const lastLine = Math.max(0, lines.length - 1);

  const headTo = Math.min(lastLine, Math.max(adjust, start));
  const tailFrom = Math.max(0, Math.min(lastLine - adjust, end));

  return {
    lastLine,
    head: lines.slice(0, headTo + 1).map((l) => firstSentence(l)),
    tailFrom,
    tail: lines.slice(tailFrom).map((l) => firstSentence(l)),
  };
}


/**
 * Позиция в тексте → номер строки.
 *
 * Возвращает функцию, а не число: таблица начал строк строится один раз,
 * а спрашивают у неё тысячи раз — по разу на каждое вхождение каждого слова.
 * Двоичный поиск по готовой таблице против пересчёта на каждый вопрос.
 */
export function lineIndexer(text: string): (offset: number) => number {
  const starts = [0];
  for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) {
    starts.push(i + 1);
  }

  return (offset) => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };
}
