import type { LlmPort } from './llm.js';
import { extractJson } from './llm.js';
import { checkLeak, checkAmbiguity } from './validate.js';
import type { Deck } from './score.js';

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

/** Сколько раз пробуем перегенерировать карточку, не прошедшую проверки. */
const MAX_ATTEMPTS = 2;

const SPEAK_SYSTEM = `Ты помогаешь русскоязычному студенту уровня B2 учить английский.

ЗАДАЧА. По слову и контекстам из книги сделать карточки формата cloze для
активного словаря — того, что студент должен уметь ПРОИЗНЕСТИ.

ГРУППИРОВКА ПО ЗНАЧЕНИЯМ — САМОЕ ВАЖНОЕ.
Одна карточка = одно ЗНАЧЕНИЕ, а НЕ один контекст. Контекстов может быть
десять, а карточка при этом одна.

Порядок работы: раздели контексты на группы по значению, затем сделай
РОВНО ОДНУ карточку на группу. Бери только значения, засвидетельствованные
в контекстах, а не все словарные.

НЕ являются разными значениями:
- грамматические формы: bait / baits, chop / chopped — это одно значение
- разные подлежащие или обстоятельства при том же смысле
- стилистические оттенки

Являются разными значениями:
- drift плыть по течению / медленно перемещаться в воздухе
- faint слабый, едва различимый / потерять сознание

Если все контексты про одно значение — верни РОВНО ОДИН объект с sense = null.
Массив из двух объектов с sense = null — ошибка.

ФОРМАТ КАРТОЧКИ:
- front: ТВОЁ СОБСТВЕННОЕ предложение (не из книги!) с пропуском вида "t___",
  где показана только первая буква ответа. В конце в скобках русская подсказка.
- back: "ответ — русский перевод"
- answer: само слово в той форме, что стоит в пропуске

ЖЁСТКИЕ ТРЕБОВАНИЯ К ПРЕДЛОЖЕНИЮ:
1. Контекст должен допускать ТОЛЬКО этот ответ. Проверь себя: если в пропуск
   на ту же букву влезает другое подходящее по смыслу слово (timid/tired,
   taut/tight, cautiously/carefully) — переделай предложение, добавив
   уточняющую часть, которая исключает альтернативы.
2. Одна новая единица на карточку. Остальные слова в предложении должны быть
   простыми.
3. Предложение бытовое и естественное, 8-15 слов.

ЖЁСТКИЕ ТРЕБОВАНИЯ К ПОДСКАЗКЕ:
1. НЕ содержит ответ и его корень ни в каком виде.
2. НЕ является русским заимствованием от ответа: для triumph нельзя "триумф",
   для fiasco нельзя "фиаско" — это озвучивает ответ через звучание.
   Описывай смысл в обход.

Ответь ТОЛЬКО массивом JSON, без пояснений и без markdown:
[{"sense": null или "краткое описание значения по-русски",
  "front": "...", "back": "...", "answer": "..."}]`;

const READ_SYSTEM = `Ты помогаешь русскоязычному студенту уровня B2 учить английский.

ЗАДАЧА. По слову и контекстам из книги сделать карточки для ПАССИВНОГО словаря —
студенту нужно только узнавать слово при чтении, произносить его он не будет.

ГРУППИРОВКА ПО ЗНАЧЕНИЯМ. Одна карточка = одно ЗНАЧЕНИЕ, а НЕ один контекст.
Раздели контексты на группы по значению и сделай РОВНО ОДНУ карточку на группу.
Грамматические формы (единственное/множественное число, времена) разными
значениями НЕ являются. Если значение одно — верни РОВНО ОДИН объект
с sense = null. Внимание: слово может употребляться не в том
значении, которое первым приходит в голову (например, dolphin у Хемингуэя —
это корифена, рыба, а не дельфин; stern — корма лодки, а не "суровый").
Смотри на контексты, а не на самое частое значение слова.

ФОРМАТ: front — само слово, back — русский перевод именно этого значения.
Если значение неочевидное, добавь короткое пояснение в скобках.

Ответь ТОЛЬКО массивом JSON, без пояснений и без markdown:
[{"sense": null или "краткое описание", "front": "слово", "back": "перевод", "answer": "слово"}]`;

interface RawCard {
  sense: string | null;
  front: string;
  back: string;
  answer: string;
}

function userPrompt(lemma: string, pos: string, contexts: string[]): string {
  return `Слово: ${lemma} (${pos})

Контексты из книги:
${contexts.map((c, i) => `${i + 1}. ${c}`).join('\n')}`;
}

/**
 * Вторая проверка: модель заполняет пропуск, НЕ видя ответа.
 * Вернула другое слово — контекст не сужает выбор.
 */
async function fillBlank(llm: LlmPort, front: string): Promise<string> {
  const raw = await llm.complete(
    'Заполни пропуск в английском предложении одним словом. Ответь ТОЛЬКО этим словом, без пояснений.',
    front,
  );
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
  const system = deck === 'speak' ? SPEAK_SYSTEM : READ_SYSTEM;
  let raws: RawCard[] = [];

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const hint =
      attempt === 1
        ? ''
        : '\n\nПРЕДЫДУЩАЯ ПОПЫТКА НЕ ПРОШЛА ПРОВЕРКУ. Причины:\n' +
        raws.flatMap((r) => checkLeak(r.front, r.answer).problems).join('\n') +
        '\nПеределай.';
    raws = extractJson<RawCard[]>(
      await llm.complete(system, userPrompt(lemma, pos, contexts) + hint),
    );
    if (raws.every((r) => checkLeak(r.front, r.answer).ok)) break;
  }

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
    const problems = [...checkLeak(r.front, r.answer).problems];

    // Проверка на неоднозначность нужна только cloze: в read-карточке
    // на лицевой стороне само слово, заполнять нечего.
    if (deck === 'speak' && problems.length === 0) {
      const filled = await fillBlank(llm, r.front);
      problems.push(...checkAmbiguity(r.answer, filled).problems);
    }

    cards.push({
      id: `${lemma}-${deck}-${cards.length}`,
      lemma,
      deck,
      sense: r.sense,
      front: r.front,
      back: r.back,
      answer: r.answer,
      bookHash,
      createdAt: new Date().toISOString(),
      problems,
    });
  }

  return cards;
}