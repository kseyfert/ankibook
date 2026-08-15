/**
 * Нормализация. Порядок операций важен: сначала чиним символы,
 * потом склейку переносов, и только потом схлопываем пробелы.
 */

const CHAR_MAP: Array<[RegExp, string]> = [
  // Апострофы. КРИТИЧНО: типографский U+2019 ломает токенизацию,
  // из-за него получаются мусорные токены didn / hasn / don.
  [/[\u2018\u2019\u02BC\u055A]/g, "'"],
  // Кавычки
  [/[\u201C\u201D\u201E\u00AB\u00BB]/g, '"'],
  // Тире всех сортов → обычный дефис-минус с пробелами вокруг em-dash
  [/\u2014/g, ' — '],
  [/[\u2013\u2012\u2212]/g, '-'],
  // Многоточие
  [/\u2026/g, '...'],
  // Невидимки: мягкий перенос, zero-width, BOM
  [/[\u00AD\u200B\u200C\u200D\uFEFF]/g, ''],
  // Неразрывный и прочие экзотические пробелы
  [/[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g, ' '],
];

/** Переносы слов на конце строки: "sar-\ndines" → "sardines" */
function joinHyphenated(s: string): string {
  return s.replace(/([a-zа-яё])-\s*\n\s*([a-zа-яё])/gi, '$1$2');
}

export function normalizeText(raw: string): string {
  let s = raw.normalize('NFC');
  for (const [re, to] of CHAR_MAP) s = s.replace(re, to);
  s = joinHyphenated(s);
  s = s.replace(/\r\n?/g, '\n');
  s = s.replace(/[ \t]+/g, ' ');
  s = s.replace(/ *\n */g, '\n');
  s = s.replace(/\n{3,}/g, '\n\n'); // максимум одна пустая строка
  return s.trim();
}

/** Для поиска: регистр вниз, любые пробелы схлопнуты. */
export function canonical(s: string): string {
  return normalizeText(s).toLowerCase().replace(/\s+/g, ' ');
}

export function countWords(s: string): number {
  const m = s.match(/[\p{L}][\p{L}'-]*/gu);
  return m ? m.length : 0;
}