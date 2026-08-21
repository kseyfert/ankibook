/**
 * Проверки карточек перед экспортом.
 *
 * Карточку из Noji нельзя ни отредактировать, ни удалить — только добавить.
 * Значит любая ошибка вечная, и валидация здесь не опция, а обязательный шаг.
 *
 * Обе проверки выведены из реальных ошибок, а не придуманы:
 *   1) утечка   — подсказка «(be fond of)» содержала сам ответ
 *   2) когнат   — подсказка «(триумф)» озвучивала ответ triumph через звучание
 *   3) неоднозначность — «She was too t___ to ask for a raise» одинаково
 *      допускает timid и tired
 */

/** Кириллица → латиница, огрублённо. Нужно только для сравнения корней. */
const TRANSLIT: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z',
  и: 'i', й: 'i', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r',
  с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch',
  ъ: '', ы: 'y', ь: '', э: 'e', ю: 'u', я: 'a',
};

function translit(s: string): string {
  return s.toLowerCase().split('').map((c) => TRANSLIT[c] ?? c).join('');
}

/** Латинские буквы, которые часто взаимозаменяемы при заимствовании. */
function fold(s: string): string {
  return s
    .toLowerCase()
    .replace(/ph/g, 'f')
    .replace(/[ck]/g, 'k')
    .replace(/[yj]/g, 'i')
    .replace(/[^a-z]/g, '');
}

export interface CheckResult {
  ok: boolean;
  problems: string[];
}

/**
 * Ответ не должен быть виден на лицевой стороне — ни напрямую,
 * ни через русское заимствование.
 *
 * ТОЛЬКО ДЛЯ CLOZE. На карточке для узнавания слово на лицевой стороне —
 * это и есть формат, а не утечка: там нечего угадывать, там надо вспомнить
 * перевод. Прогнав read-карточку через эту проверку, получаешь вечный отказ
 * и переделку в чужой формат.
 */
export function checkLeak(front: string, answer: string): CheckResult {
  const problems: string[] = [];
  const a = answer.toLowerCase().trim();
  if (!a) return { ok: false, problems: ['пустой ответ'] };

  // Пропуск в cloze маскируем, иначе первая буква засчитается как утечка.
  const masked = front.toLowerCase().replace(/[a-z]?_{2,}/g, ' ');

  const stem = a.slice(0, Math.min(4, a.length));
  if (masked.includes(a)) problems.push(`ответ "${a}" присутствует на лицевой стороне`);
  else if (a.length >= 4 && masked.includes(stem)) problems.push(`корень "${stem}" присутствует на лицевой стороне`);

  // Когнат: русская подсказка, звучащая как ответ. «триумф» → triumf ≈ triumph.
  const cyr = masked.match(/[а-яё]+/g) ?? [];
  const foldedAnswer = fold(a);
  for (const w of cyr) {
    const f = fold(translit(w));
    if (f.length < 4 || foldedAnswer.length < 4) continue;
    if (f.startsWith(foldedAnswer.slice(0, 4)) || foldedAnswer.startsWith(f.slice(0, 4))) {
      problems.push(`подсказка "${w}" — когнат ответа "${a}", карточка становится бесплатной`);
    }
  }

  return { ok: problems.length === 0, problems };
}

/** Ответ, который вернула модель, заполняя пропуск вслепую. */
export interface FillResult {
  filled: string;
}

/**
 * Неоднозначность: модель заполняет пропуск, НЕ видя ответа.
 * Вернула другое слово — карточка допускает несколько прочтений.
 *
 * Это буквально симуляция затупа на timid/tired: если модель, читая
 * то же предложение, выбирает иначе, значит контекст не сужает выбор.
 */
export function checkAmbiguity(answer: string, filled: string): CheckResult {
  const a = answer.toLowerCase().trim();
  const f = filled.toLowerCase().trim().replace(/[^a-z' -]/g, '');
  if (!f) return { ok: false, problems: ['модель не смогла заполнить пропуск'] };
  if (f === a) return { ok: true, problems: [] };
  // Формы одного слова считаем совпадением: taut/tauter — не неоднозначность.
  const stemLen = Math.min(4, a.length, f.length);
  if (stemLen >= 4 && (f.startsWith(a.slice(0, stemLen)) || a.startsWith(f.slice(0, stemLen)))) {
    return { ok: true, problems: [] };
  }
  return {
    ok: false,
    problems: [`контекст допускает "${f}" наравне с "${a}" — предложение не сужает выбор`],
  };
}

/**
 * Формат карточки.
 *
 * Проверка формальная и бесплатная, но нужная: модель регулярно теряет
 * русскую подсказку (breeze вышел без неё), а без подсказки возвращается
 * ровно та неоднозначность timid/tired, ради которой подсказку и вводили.
 *
 * Заодно требуем лемму на обороте: в пропуске стоит нужная ФОРМА (chopped),
 * а знать надо словарное слово (chop). Без леммы в колоде окажется форма,
 * и связь со словарём потеряется.
 */
export function checkFormat(
  front: string,
  back: string,
  answer: string,
  lemma: string,
  deck: 'speak' | 'read',
): CheckResult {
  const problems: string[] = [];

  if (deck === 'speak') {
    const blank = front.match(/([a-z])(_{2,})/i);
    if (!blank) {
      problems.push('на лицевой стороне нет пропуска вида "t___"');
    } else {
      // Пропуск обязан соответствовать ответу. Реальный случай: ответ chew,
      // а в предложении стояло "s_____" — и буква чужая, и длина не та.
      // Все три другие проверки это пропустили: маскировка пропуска в
      // checkLeak, а модель при заполнении вслепую прочитала русскую
      // подсказку и ответила верно, проигнорировав букву.
      // Проверяем только БУКВУ. Длину не проверяем: модели плохо считают
      // символы, и отвергать карточку из-за лишнего подчёркивания значит
      // жечь попытки перегенерации на ерунде. Длина чинится в коде
      // функцией fixBlank — детерминированно и бесплатно.
      const [, letter] = blank;
      const a = answer.trim();
      if (letter.toLowerCase() !== a[0]?.toLowerCase()) {
        problems.push(`пропуск начинается на "${letter}", а ответ — "${a}"`);
      }
    }
    if (!/\([^)]*[а-яё][^)]*\)/i.test(front)) {
      problems.push('на лицевой стороне нет русской подсказки в скобках');
    }
  } else {
    // Лицевая сторона карточки на узнавание — САМО СЛОВО, а не предложение.
    // Проверка появилась не от хорошей жизни: read-карточки выходили в виде
    // cloze, потому что формат этой колоды не проверял никто.
    if (/_{2,}/.test(front)) {
      problems.push('на лицевой стороне пропуск, а нужна словарная форма слова');
    } else if (front.trim().split(/\s+/).length > 3) {
      problems.push('на лицевой стороне предложение, а нужно само слово');
    }
  }

  // Граница слова обязательна: "chopped".includes("chop") истинно,
  // и без \b форма проходила бы за словарное слово.
  const l = lemma.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const hasLemma = new RegExp(`(^|[^a-z])${l}([^a-z]|$)`, 'i').test(back);
  if (!hasLemma) {
    const a = answer.toLowerCase();
    problems.push(
      a === l
        ? `на обороте нет самого слова "${lemma}"`
        : `на обороте форма "${answer}", но нет словарной формы "${lemma}"`,
    );
  }

  return { ok: problems.length === 0, problems };
}

/**
 * Приводит длину пропуска в соответствие с ответом.
 *
 * Модель ставит подчёркивания на глаз и часто ошибается на одно-два.
 * Это чинится арифметикой, а не перегенерацией.
 */
export function fixBlank(front: string, answer: string): string {
  const a = answer.trim();
  if (a.length < 2) return front;
  return front.replace(
    /([a-z])(_{2,})/i,
    (m, letter: string) =>
      letter.toLowerCase() === a[0].toLowerCase() ? letter + '_'.repeat(a.length - 1) : m,
  );
}