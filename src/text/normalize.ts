/**
 * Нормализация английского текста перед токенизацией.
 *
 * Готовых пакетов для этой задачи в npm нет (проверено: smartquotes и
 * smartypants работают в ОБРАТНУЮ сторону — превращают ASCII в типографику).
 * Ближайший аналог, ftfy, существует только на Python.
 *
 * Порядок операций важен: сначала чиним символы, потом склейку переносов,
 * и только в конце схлопываем пробелы.
 */

const CHAR_MAP: Array<[RegExp, string]> = [
  // Апострофы. КРИТИЧНО: типографский U+2019 ломает токенизацию —
  // из-за него didn't распадается на мусорные токены didn / t.
  [/[\u2018\u2019\u02BC\u055A]/g, "'"],
  // Кавычки
  [/[\u201C\u201D\u201E\u00AB\u00BB]/g, '"'],
  // Тире: em-dash разделяет слова, поэтому с пробелами
  [/\u2014/g, ' — '],
  [/[\u2013\u2012\u2212]/g, '-'],
  [/\u2026/g, '...'],
  // Невидимки: мягкий перенос, zero-width, BOM
  [/[\u00AD\u200B\u200C\u200D\uFEFF]/g, ''],
  // Неразрывный и прочие экзотические пробелы
  [/[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g, ' '],
];

/**
 * Переносы слов на конце строки: "sar-\ndines" → "sardines".
 *
 * Применяется ТОЛЬКО внутри одного блока. Если запустить по всему
 * склеенному тексту, `\s*` съест разделитель абзацев \n\n, и абзац,
 * кончающийся дефисом, слипнется со следующим: "must kill-" + "Sardines"
 * даст несуществующее слово killSardines, которое пройдёт любой
 * частотный порог как сверхредкое и станет карточкой.
 */
function joinHyphenated(s: string): string {
  return s.replace(/([a-z])-[ \t]*\n[ \t]*([a-z])/gi, '$1$2');
}

export function normalizeText(raw: string): string {
  let s = raw.normalize('NFC');
  for (const [re, to] of CHAR_MAP) s = s.replace(re, to);
  s = s.replace(/\r\n?/g, '\n');
  s = joinHyphenated(s);
  s = s.replace(/[ \t]+/g, ' ');
  s = s.replace(/ *\n */g, '\n');
  s = s.replace(/\n{3,}/g, '\n\n');
  return s.trim();
}

export function countWords(s: string): number {
  return (s.match(/[a-z][a-z'-]*/gi) ?? []).length;
}