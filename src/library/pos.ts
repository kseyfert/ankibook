/** Читаемые названия частей речи. Теги Universal POS человеку ничего не говорят. */
const NAMES: Record<string, string> = {
  NOUN: 'существительное',
  VERB: 'глагол',
  ADJ: 'прилагательное',
  ADV: 'наречие',
  PROPN: 'имя собственное',
  INTJ: 'междометие',
  ADP: 'предлог',
  PRON: 'местоимение',
  DET: 'артикль',
  AUX: 'вспомогательный глагол',
  CCONJ: 'союз',
  SCONJ: 'союз',
  NUM: 'числительное',
  PART: 'частица',
  X: 'не определено',
};

export const posName = (tag: string): string => NAMES[tag] ?? tag.toLowerCase();

/** Короткая форма для таблиц. */
const SHORT: Record<string, string> = {
  NOUN: 'сущ.', VERB: 'глаг.', ADJ: 'прил.', ADV: 'нареч.',
  PROPN: 'имя собств.', INTJ: 'междом.', ADP: 'предлог', PRON: 'мест.',
  DET: 'артикль', AUX: 'вспом. глаг.', CCONJ: 'союз', SCONJ: 'союз',
  NUM: 'числ.', PART: 'частица', X: '—',
};

export const posShort = (tag: string): string => SHORT[tag] ?? tag.toLowerCase();

/**
 * Части речи, которые не попадают в словарь.
 *
 * PROPN — имена собственные: Santiago, DiMaggio, а в книгах Gutenberg ещё
 * и весь текст лицензии (gutenberg, foundation, license, ebook, archive).
 * INTJ — междометия: oh, ah, alas. Учить нечего.
 * X — теггер не смог определить.
 *
 * Оговорка: теггер ошибается. У поэтов «O Spring!» с заглавной даёт PROPN
 * для настоящего слова spring. Поэтому список исключённого вручную работает
 * в обе стороны — см. user/excluded.json.
 */
export const SKIP_POS = new Set(['PROPN', 'INTJ', 'X', 'PUNCT', 'SYM']);