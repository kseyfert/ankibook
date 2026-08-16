import type { DictEntry, Profile } from './store/types.js';

/**
 * Скоринг кандидатов. Две НЕЗАВИСИМЫЕ оси, их нельзя складывать в одну:
 *
 *   bookValue — польза для чтения этой книги. Слово, встреченное 48 раз,
 *               экономит 48 спотыканий.
 *
 *   lifeValue — польза вообще. НЕ растёт монотонно с редкостью: максимум
 *               у границы порога знания (слово частое настолько, чтобы
 *               встречаться регулярно, и редкое настолько, чтобы быть
 *               незнакомым), спад к нулю в сторону экзотики.
 *
 * Маршрут: высокий lifeValue → speak (продукция включает узнавание),
 * иначе → read.
 */

/** Ниже этой частотности слово в жизни практически не встретится. */
const FLOOR_ZIPF = 2.0;
/** Столько вхождений уже дают максимальный bookValue. */
const SATURATION = 40;
/** Со стольких книг слово считается частью языка, а не жаргоном одной книги. */
const HISTORY_OVERRIDE = 3;

const CONTENT_POS = new Set(['NOUN', 'VERB', 'ADJ', 'ADV']);

export type Deck = 'speak' | 'read';

export interface Candidate {
  entry: DictEntry;
  /** число вхождений в текущей книге */
  countInBook: number;
  bookValue: number;
  lifeValue: number;
  /** приоритет внутри колоды */
  priority: number;
  /** переизбыточность относительно ожидаемой частоты */
  overrepresentation: number;
  /** частое слово, здесь резко переизбыточное — проверить значение глазами */
  checkSense: boolean;
  suggested: Deck;
  reason: string;
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

/** Ожидаемое число вхождений в тексте из totalWords слов. */
function expected(zipf: number, totalWords: number): number {
  return zipf === 0 ? 0 : totalWords * Math.pow(10, zipf - 9);
}

/** Слово вообще не рассматривается как кандидат. */
export function isEligible(d: DictEntry, profile: Profile): boolean {
  if (d.speak !== 'new' || d.read !== 'new') return false;
  if (!CONTENT_POS.has(d.pos)) return false;
  if (d.lemma.length < 3) return false;
  if (d.totalCount === 0) return false;
  // Нет в частотной таблице: имя собственное, опечатка или химера склейки.
  // Спасаем только часто повторяющееся — свидетельство, что слово настоящее.
  if (d.zipf === 0 && d.totalCount < 4) return false;
  // Выше порога знания. Исключение: слово из третьей книги — раз оно
  // упорно попадается именно в твоём чтении, глобальная статистика врёт.
  if (d.zipf >= profile.knownZipf && d.bookCount < HISTORY_OVERRIDE) return false;
  // Единственное вхождение и никакой истории — свидетельств нет.
  if (d.totalCount === 1 && d.bookCount < 2) return false;
  return true;
}

export function scoreCandidate(
  d: DictEntry,
  bookHash: string,
  bookWords: number,
  profile: Profile,
): Candidate {
  const countInBook = d.books[bookHash] ?? 0;
  const exp = expected(d.zipf, bookWords);
  const over = exp > 0 ? countInBook / exp : Infinity;

  const bookValue = clamp01(Math.log2(Math.max(1, countInBook)) / Math.log2(SATURATION));

  const span = profile.knownZipf - FLOOR_ZIPF;
  const base = d.zipf === 0 ? 0 : clamp01((d.zipf - FLOOR_ZIPF) / span);
  // История — свидетельство из ТВОЕГО чтения, оно сильнее глобальной
  // статистики. Логарифм: вторая книга даёт много, десятая уже мало.
  const historyBonus = Math.min(0.5, 0.3 * Math.log2(1 + Math.max(0, d.bookCount - 1)));
  const lifeValue = clamp01(base + historyBonus);

  // Частое слово, встреченное на два порядка чаще ожидаемого. Иногда это
  // другое значение (dolphin у Хемингуэя — корифена; stern — корма),
  // иногда просто тема книги (breeze, turtle). Статистикой не различить,
  // поэтому это ПОМЕТКА для глаз, а не решение о колоде.
  const checkSense = d.zipf >= profile.knownZipf - 0.3 && over > 50;

  let suggested: Deck;
  let reason: string;
  if (lifeValue >= 0.5) {
    suggested = 'speak';
    reason = d.bookCount > 1 ? `общеупотребимое, ${d.bookCount} кн.` : 'общеупотребимое';
  } else {
    suggested = 'read';
    reason = over > 100 ? 'лексика этой книги' : 'редкое, хватит узнавания';
  }

  const priority =
    suggested === 'speak' ? 0.7 * lifeValue + 0.3 * bookValue : 0.8 * bookValue + 0.2 * lifeValue;

  return {
    entry: d,
    countInBook,
    bookValue,
    lifeValue,
    priority,
    overrepresentation: over,
    checkSense,
    suggested,
    reason,
  };
}

export function selectCandidates(
  dict: Map<string, DictEntry>,
  bookHash: string,
  bookWords: number,
  profile: Profile,
  topN: number,
): Candidate[] {
  return [...dict.values()]
    .filter((d) => isEligible(d, profile) && (d.books[bookHash] ?? 0) > 0)
    .map((d) => scoreCandidate(d, bookHash, bookWords, profile))
    .sort((a, b) => b.priority - a.priority)
    .slice(0, topN);
}