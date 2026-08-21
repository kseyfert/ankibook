import type { Card } from '../library/types.js';
import { localProblems } from './generate.js';
import { fixBlank } from './validate.js';

/**
 * Правка карточки руками.
 *
 * Проверки после правки НЕ отключаются: карточку из Noji нельзя ни исправить,
 * ни удалить, и человек ошибается ровно так же, как модель. Но гоняются
 * только те, которым не нужна модель, — формат и утечка ответа. Проверка
 * на неоднозначность стоит запроса, а правку сохраняют по одной строке
 * за раз; она остаётся за генерацией и перегенерацией.
 *
 * Длина пропуска чинится арифметикой, как и при генерации: считать
 * подчёркивания человеку так же скучно, как модели.
 */
/**
 * Сторона карточки — одна строка текста.
 *
 * Перенос, попавший из поля ввода, уезжает прямо внутрь поля CSV. Формально
 * это допустимо — поле в кавычках, — но что с ним сделает импорт Noji,
 * неизвестно, а проверить, разобравшись, уже нельзя: карточку оттуда
 * не забрать. Схлопываем любой пробельный набор в один пробел.
 */
const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim();

export function editCard(card: Card, patch: { front?: string; back?: string }): Card {
  const next: Card = {
    ...card,
    front: oneLine(patch.front ?? card.front),
    back: oneLine(patch.back ?? card.back),
  };
  if (next.deck === 'speak') next.front = fixBlank(next.front, next.answer);

  return { ...next, problems: localProblems(next, next.lemma, next.deck) };
}
