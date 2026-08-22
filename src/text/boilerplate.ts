import type { LlmPort } from '../llm/index.js';
import { extractJson } from '../llm/index.js';
import { bookBoundsPrompt } from '../llm/prompts.js';
import { tuning } from '../config/index.js';

/**
 * Где в файле книги кончается служебный текст и начинается сама книга.
 *
 * Модуль НИЧЕГО НЕ РЕЖЕТ. Он возвращает предположение, текст сохраняется
 * целиком, а решение принимает человек в интерфейсе. Ошибка модели здесь
 * стоит одного движения ползунка, а не потерянной главы.
 *
 * Границы ВСЕГДА числа. Служебного блока нет, фильтр выключен, модель
 * недоступна, ответ не разобрался — возвращаем 0 и номер последней строки,
 * то есть «резать нечего». Так потребитель этих полей не разбирает случаи
 * и не путает «не знаем» с «начало на нуле»: и то и другое означает одно —
 * бери всё.
 */
export interface BookBounds {
  /** номер первой строки основного текста */
  expectedStartLine: number;
  /** номер последней строки основного текста, ВКЛЮЧИТЕЛЬНО */
  expectedEndLine: number;
}

/** Что возвращает модель. Номера строк не спрашиваем — считать она не умеет. */
interface RawBounds {
  firstWords: string | null;
  lastWords: string | null;
}

/**
 * Приводит ответ модели к одной паре цитат.
 *
 * Промпт просит один объект, но модель регулярно возвращает несколько
 * вариантов подряд — а `extractJson` в таком случае отдаёт массив. Прочитав
 * его как объект, получаешь `undefined` в обоих полях и молча теряешь
 * границы: именно так на субтитрах терялась подпись релиз-группы в конце.
 *
 * Поля берутся НЕЗАВИСИМО, первое непустое по каждому. Выбирать «правильный»
 * объект не нужно: настоящая проверка — поиск цитаты в своём окне, и негодная
 * отсеется там же.
 */
function pickBounds(parsed: unknown): RawBounds {
  const list = Array.isArray(parsed) ? parsed : [parsed];
  const first = (key: keyof RawBounds): string | null => {
    for (const item of list) {
      const value = (item as RawBounds | null | undefined)?.[key];
      if (typeof value === 'string' && value.trim()) return value;
    }
    return null;
  };
  return { firstWords: first('firstWords'), lastWords: first('lastWords') };
}

/**
 * Минимум слов, по которым признаём цитату найденной.
 * Четыре слова подряд — уже достаточно редкое совпадение, чтобы не поймать
 * чужой абзац; на трёх начинают ловиться служебные обороты.
 */
const MIN_WORDS = 4;

/** Маркер обрыва по длине. Без него модель сочтёт абзац оборванным по смыслу. */
const CUT = ' […]';

/**
 * Строка для окна: обрезаем длинные и помечаем обрыв.
 *
 * Режем по границе слова — оборванное посередине слово модель попробует
 * достроить и процитирует то, чего в тексте нет.
 */
function clip(line: string, max: number): string {
  // {{ в тексте книги сломало бы подстановку в шаблоне: она считает такое
  // незаполненным плейсхолдером и бросает ошибку. Разводим скобки.
  const safe = line.replace(/\{\{/g, '{ {');
  if (safe.length <= max) return safe;

  const cut = safe.slice(0, max);
  const space = cut.lastIndexOf(' ');
  // Если пробела в первой половине нет — это одно длинное «слово»
  // (адрес, таблица). Резать по нему нечего, рвём как есть.
  return (space > max / 2 ? cut.slice(0, space) : cut).trimEnd() + CUT;
}

interface Window {
  text: string;
  /** первая строка окна в исходной нумерации */
  from: number;
  /** последняя строка окна, включительно */
  to: number;
}

/**
 * Окно с начала: строки набираются, пока помещаются в потолок.
 *
 * Первая строка входит всегда, даже если одна перекрывает потолок: пустое
 * окно означало бы, что спрашивать не о чем, а спросить как раз надо.
 */
function headWindow(lines: string[], headLines: number, maxLineChars: number, maxChars: number): Window {
  const out: string[] = [];
  let used = 0;
  let to = 0;

  for (let i = 0; i < Math.min(headLines, lines.length); i++) {
    const l = clip(lines[i], maxLineChars);
    if (out.length && used + l.length + 1 > maxChars) break;
    out.push(l);
    used += l.length + 1;
    to = i;
  }

  return { text: out.join('\n'), from: 0, to };
}

/**
 * Окно с конца. Набирается ОТ КОНЦА НАЗАД: лицензия лежит в самом хвосте,
 * и, начни мы считать с головы окна, потолок отрезал бы именно её.
 */
function tailWindow(lines: string[], tailLines: number, maxLineChars: number, maxChars: number): Window {
  const last = lines.length - 1;
  const stop = Math.max(0, lines.length - tailLines);
  const out: string[] = [];
  let used = 0;
  let from = last;

  for (let i = last; i >= stop; i--) {
    const l = clip(lines[i], maxLineChars);
    if (out.length && used + l.length + 1 > maxChars) break;
    out.unshift(l);
    used += l.length + 1;
    from = i;
  }

  return { text: out.join('\n'), from, to: last };
}

/** Для сравнения важны только буквы и цифры: пунктуация и регистр в цитате плывут. */
const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/**
 * Номер строки, содержащей цитату. Ищем ТОЛЬКО внутри своего окна.
 *
 * По всему тексту искать нельзя: фраза вроде «he did not know» встречается
 * в книге десятки раз, первое вхождение окажется где-нибудь в середине,
 * и граница уедет туда же.
 *
 * Несколько вхождений в окне — берём самый широкий диапазон: для начала
 * самое раннее, для конца самое позднее. Ошибиться в сторону «взяли лишнего»
 * дешевле, чем срезать страницу настоящего текста.
 */
function findLine(
  lines: string[],
  w: Window,
  quote: string,
  edge: 'start' | 'end',
): number | null {
  const words = norm(quote).split(' ').filter(Boolean);
  if (words.length < MIN_WORDS) return null;

  // Цитата могла прихватить лишнее слово или потерять его — укорачиваем
  // с дальнего от границы конца, чтобы отличительная часть уцелела:
  // у начала книги это первые слова, у конца — последние.
  for (let n = words.length; n >= MIN_WORDS; n--) {
    const needle = (edge === 'start' ? words.slice(0, n) : words.slice(-n)).join(' ');
    let found: number | null = null;

    for (let i = w.from; i <= w.to; i++) {
      if (!norm(lines[i]).includes(needle)) continue;
      if (edge === 'start') return i;
      found = i;
    }

    if (found !== null) return found;
  }

  return null;
}

export async function detectBookBounds(text: string, llm: LlmPort): Promise<BookBounds> {
  const lines = text.split('\n');
  const last = Math.max(0, lines.length - 1);
  const whole: BookBounds = { expectedStartLine: 0, expectedEndLine: last };

  const cfg = tuning.bookBounds;
  if (!cfg.enabled) return whole;

  const head = headWindow(lines, cfg.headLines, cfg.maxLineChars, cfg.maxWindowChars);
  const tail = tailWindow(lines, cfg.tailLines, cfg.maxLineChars, cfg.maxWindowChars);

  let raw: RawBounds;
  try {
    raw = pickBounds(
      extractJson<unknown>(
        await llm.complete('', bookBoundsPrompt({ head: head.text, tail: tail.text })),
      ),
    );
  } catch {
    // Модель недоступна, ответ без JSON, сеть отвалилась — всё это значит
    // одно: границ мы не знаем. Падать нельзя, разбор книги от них не зависит.
    return whole;
  }

  let start = 0;
  let end = last;

  if (raw.firstWords) {
    const i = findLine(lines, head, raw.firstWords, 'start');
    if (i !== null) start = i;
  }
  if (raw.lastWords) {
    const i = findLine(lines, tail, raw.lastWords, 'end');
    if (i !== null) end = i;
  }

  // Начало позже конца — значит цитаты сели не туда. Разбирать, которая
  // из двух виновата, нечем, поэтому отказываемся от обеих.
  if (start > end) return whole;

  return { expectedStartLine: start, expectedEndLine: end };
}
