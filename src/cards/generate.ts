import type { LlmPort } from '../llm/index.js';
import { extractJson } from '../llm/index.js';
import { checkLeak, checkAmbiguity, checkFormat, fixBlank } from './validate.js';
import type { Card, Deck } from '../library/types.js';
import { speakSystem, readSystem, fixSystem, fillBlankSystem, wordPrompt, fixPrompt } from '../llm/prompts.js';
import { tuning } from '../config/index.js';

export type { Card };

interface RawCard {
  sense: string | null;
  front: string;
  back: string;
  answer: string;
}

/**
 * Вторая проверка: модель заполняет пропуск, НЕ видя ответа.
 * Вернула другое слово — контекст не сужает выбор.
 */
async function fillBlank(llm: LlmPort, front: string): Promise<string> {
  const raw = await llm.complete(fillBlankSystem(), front);
  return raw.trim().split(/\s+/)[0] ?? '';
}

/** Что нужно, чтобы довести карточку до годного вида. */
interface Target {
  lemma: string;
  pos: string;
  deck: Deck;
  /** промпт колоды: он же задаёт формат при переделке */
  system: string;
}

/**
 * Доводит одну карточку: проверяет и переделывает, пока не пройдёт.
 *
 * Обе проверки внутри цикла. Раньше переделка смотрела только на утечку,
 * а неоднозначность проверялась после — карточка вроде chop/clapped
 * не переделывалась никогда. Карточку из Noji не исправить, поэтому
 * чинить надо здесь.
 *
 * Возвращает последнюю версию вместе с оставшимися замечаниями: попытки
 * кончились, а карточка всё ещё с браком — это не повод её терять, человек
 * решит сам. В экспорт она не пойдёт.
 */
async function refine(llm: LlmPort, raw: RawCard, t: Target): Promise<{ card: RawCard; problems: string[] }> {
  let card = raw;
  let problems: string[] = [];

  for (let attempt = 1; attempt <= tuning.generation.maxAttempts; attempt++) {
    // длину пропуска чиним сами, до проверок
    if (t.deck === 'speak') card = { ...card, front: fixBlank(card.front, card.answer) };
    problems = localProblems(card, t.lemma, t.deck);

    // Неоднозначность имеет смысл только для cloze: в read-карточке
    // на лицевой стороне само слово, заполнять нечего.
    if (t.deck === 'speak' && problems.length === 0) {
      const filled = await fillBlank(llm, card.front);
      problems.push(...checkAmbiguity(card.answer, filled).problems);
    }

    if (problems.length === 0 || attempt === tuning.generation.maxAttempts) break;
    card = await ask(llm, card, t, problems);
  }

  return { card, problems };
}

/** Проверки, которым не нужна модель. */
export function localProblems(
  card: { front: string; back: string; answer: string },
  lemma: string,
  deck: Deck,
): string[] {
  return [
    ...checkFormat(card.front, card.back, card.answer, lemma, deck).problems,
    // Утечка ответа — забота только cloze. На карточке для узнавания
    // слово на лицевой стороне не утечка, а весь её смысл.
    ...(deck === 'speak' ? checkLeak(card.front, card.answer).problems : []),
  ];
}

/**
 * Просит новую версию карточки.
 *
 * Правила колоды идут ВПЕРЕДИ инструкции по переделке. Раньше формат был
 * описан прямо в fix-card.md, и описан он был как cloze — поэтому любая
 * read-карточка, попавшая в переделку, возвращалась с пропуском. Формат
 * колоды должен жить в одном месте: в промпте самой колоды.
 */
function ask(llm: LlmPort, card: RawCard, t: Target, problems: string[]): Promise<RawCard> {
  return llm
    .complete(
      `${t.system}\n\n---\n\n${fixSystem()}`,
      fixPrompt({
        lemma: t.lemma, pos: t.pos, sense: card.sense,
        front: card.front, back: card.back, answer: card.answer, problems,
      }),
    )
    .then((raw) => extractJson<RawCard>(raw));
}

const deckSystem = (deck: Deck) => (deck === 'speak' ? speakSystem() : readSystem());

export async function generateCards(
  llm: LlmPort,
  lemma: string,
  pos: string,
  contexts: string[],
  deck: Deck,
  bookHash: string,
): Promise<Card[]> {
  const system = deckSystem(deck);
  const raws = extractJson<RawCard[]>(
    await llm.complete(system, wordPrompt({ lemma, pos, contexts })),
  );

  // Жёсткий инвариант поверх промпта: несколько карточек допустимы только
  // если у них РАЗНЫЕ значения. Модель регулярно возвращает по 2-3 варианта
  // одного и того же с sense = null — это дубли, а не значения, и в SRS
  // они означают повторение одной единицы дважды.
  const seen = new Set<string>();
  const unique = raws.filter((r) => {
    const key = (r.sense ?? '').trim().toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const cards: Card[] = [];
  for (const r of unique) {
    const { card, problems } = await refine(llm, r, { lemma, pos, deck, system });
    cards.push({
      id: `${lemma}-${deck}-${cards.length}`,
      lemma,
      deck,
      sense: card.sense,
      front: card.front,
      back: card.back,
      answer: card.answer,
      bookHash,
      createdAt: new Date().toISOString(),
      problems,
    });
  }

  return cards;
}

/** Причина переделки, когда карточка формально исправна — просто не нравится. */
const ANOTHER_TAKE =
  'карточка формально верна, но нужен другой вариант: другое предложение ' +
  'и другая подсказка, то же слово и то же значение';

/**
 * Сделать карточку заново, сохранив её место.
 *
 * Слово и значение те же, id и позиция в файле те же — меняется только
 * содержимое. Иначе перегенерация ломала бы уже снятые галочки: они
 * помнятся по id.
 */
export async function regenerateCard(llm: LlmPort, card: Card, pos: string): Promise<Card> {
  const t: Target = { lemma: card.lemma, pos, deck: card.deck, system: deckSystem(card.deck) };
  const fresh = await ask(llm, card, t, [ANOTHER_TAKE]);
  const { card: done, problems } = await refine(llm, fresh, t);

  return {
    ...card,
    sense: done.sense,
    front: done.front,
    back: done.back,
    answer: done.answer,
    createdAt: new Date().toISOString(),
    problems,
  };
}
