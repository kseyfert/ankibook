import type { Deck, DictEntry, Profile } from './types.js';
import { tuning } from '../config/index.js';

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



export type { Deck };

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

/**
 * Слово вообще не рассматривается как кандидат.
 *
 * Проверок здесь ровно три, и все они про состояние, а не про качество
 * слова. Качество — забота человека на шаге отбора: он видит частотность,
 * часть речи и число вхождений и ставит галочки сам. Раньше здесь стояли
 * ещё четыре фильтра — по части речи, по единственному вхождению, по
 * отсутствию в частотной таблице, — и они молча выбрасывали то, что человек
 * уже выбрал руками. На реальной книге из 320 отмеченных до отбора доходило
 * 93; остальные оседали в словаре навсегда, не попадая никуда.
 *
 * Что в словаре — то рано или поздно должно попасть в колоду и уехать
 * в Noji. Иначе словарь превращается в кладбище.
 */
export function isEligible(d: DictEntry, profile: Profile): boolean {
  // Решение уже принято: колода выбрана, слово знакомо или не нужно.
  if (d.speak !== 'new' || d.read !== 'new') return false;
  // Источников не осталось — книгу удалили. Счётчики нулевые, предлагать нечего.
  if (d.totalCount === 0) return false;
  // Выше порога знания. Граница ВКЛЮЧАЮЩАЯ: ползунок на шаге отбора
  // тоже включает своё крайнее значение, и расхождение на волосок съедало
  // ровно те слова, что стоят на самом пороге.
  // Исключение: слово из третьей книги — раз оно упорно попадается именно
  // в твоём чтении, глобальная статистика врёт.
  if (d.zipf > profile.knownZipf && d.bookCount < tuning.scoring.historyOverride) return false;
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

  const t = tuning.scoring;
  const bookValue = clamp01(Math.log2(Math.max(1, countInBook)) / Math.log2(t.saturation));

  const span = profile.knownZipf - t.floorZipf;
  const base = d.zipf === 0 ? 0 : clamp01((d.zipf - t.floorZipf) / span);
  // История — свидетельство из ТВОЕГО чтения, оно сильнее глобальной
  // статистики. Логарифм: вторая книга даёт много, десятая уже мало.
  const historyBonus = Math.min(0.5, 0.3 * Math.log2(1 + Math.max(0, d.bookCount - 1)));
  const lifeValue = clamp01(base + historyBonus);

  // Частое слово, встреченное на два порядка чаще ожидаемого. Иногда это
  // другое значение (dolphin у Хемингуэя — корифена; stern — корма),
  // иногда просто тема книги (breeze, turtle). Статистикой не различить,
  // поэтому это ПОМЕТКА для глаз, а не решение о колоде.
  const checkSense = d.zipf >= profile.knownZipf - 0.3 && over > t.checkSenseRatio;

  let suggested: Deck;
  let reason: string;
  if (lifeValue >= t.speakThreshold) {
    suggested = 'speak';
    reason = d.bookCount > 1 ? `общеупотребимое, ${d.bookCount} кн.` : 'общеупотребимое';
  } else {
    suggested = 'read';
    reason = over > 100 ? 'лексика этой книги' : 'редкое, хватит узнавания';
  }

  const priority =
    suggested === 'speak'
      ? t.speakWeights.life * lifeValue + t.speakWeights.book * bookValue
      : t.readWeights.book * bookValue + t.readWeights.life * lifeValue;

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

/**
 * Топ берётся ПО КАЖДОЙ КОЛОДЕ ОТДЕЛЬНО.
 *
 * Общий топ по priority не работает: формулы у колод разные, и speak-приоритет
 * строится на lifeValue, который высок ровно у тех слов, что в speak и уходят.
 * На реальной книге общий топ-40 дал 37 speak и 3 read — за бортом остались
 * skiff ×48, oar ×25, harpoon ×20, то есть самая характерная лексика книги.
 * Сравнивать эти два числа между собой попросту нельзя.
 */
export function selectCandidates(
  dict: Map<string, DictEntry>,
  bookHash: string,
  bookWords: number,
  profile: Profile,
  topSpeak: number,
  topRead: number,
): Candidate[] {
  const scored = [...dict.values()]
    .filter((d) => isEligible(d, profile) && (d.books[bookHash] ?? 0) > 0)
    .map((d) => scoreCandidate(d, bookHash, bookWords, profile));

  const pick = (deck: Deck, n: number) =>
    scored
      .filter((c) => c.suggested === deck)
      .sort((a, b) => b.priority - a.priority)
      .slice(0, n);

  // speak первым: он требует больше внимания при просмотре
  return [...pick('speak', topSpeak), ...pick('read', topRead)];
}