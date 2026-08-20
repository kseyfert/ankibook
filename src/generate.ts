import type { LlmPort } from './llm.js';
import { extractJson } from './llm.js';
import { checkLeak, checkAmbiguity, checkFormat, fixBlank } from './validate.js';
import type { Deck } from './score.js';
import { speakSystem, readSystem, fixSystem, fillBlankSystem, wordPrompt, fixPrompt } from './prompts.js';
import { tuning } from './config.js';

export interface Card {
  id: string;
  lemma: string;
  deck: Deck;
  /** null, если значение одно */
  sense: string | null;
  front: string;
  back: string;
  /** ответ — для валидации; в CSV не идёт */
  answer: string;
  bookHash: string;
  createdAt: string;
  problems: string[];
}



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

export async function generateCards(
  llm: LlmPort,
  lemma: string,
  pos: string,
  contexts: string[],
  deck: Deck,
  bookHash: string,
): Promise<Card[]> {
  const maxAttempts = tuning().generation.maxAttempts;
  const system = deck === 'speak' ? speakSystem() : readSystem();
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
    let card = r;
    let problems: string[] = [];

    // Попытки по КАЖДОЙ карточке отдельно, с обеими проверками внутри цикла.
    // Раньше перегенерация смотрела только на утечку, а неоднозначность
    // проверялась после цикла — карточка вроде chop/clapped не переделывалась
    // никогда. Карточку из Noji не исправить, поэтому чинить надо здесь.
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      // длину пропуска чиним сами, до проверок
      if (deck === 'speak') card = { ...card, front: fixBlank(card.front, card.answer) };
      problems = [
        ...checkFormat(card.front, card.back, card.answer, lemma, deck).problems,
        ...checkLeak(card.front, card.answer).problems,
      ];

      // Неоднозначность имеет смысл только для cloze: в read-карточке
      // на лицевой стороне само слово, заполнять нечего.
      if (deck === 'speak' && problems.length === 0) {
        const filled = await fillBlank(llm, card.front);
        problems.push(...checkAmbiguity(card.answer, filled).problems);
      }

      if (problems.length === 0 || attempt === maxAttempts) break;

      card = extractJson<RawCard>(
        await llm.complete(
          fixSystem(),
          fixPrompt({ lemma, pos, sense: card.sense, front: card.front, back: card.back, answer: card.answer, problems }),
        ),
      );
    }

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