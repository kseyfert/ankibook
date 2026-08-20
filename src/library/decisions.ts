import type { DictEntry } from './types.js';

/**
 * Решение по слову при отборе. Ровно четыре исхода, как в CLI-режиме:
 * две колоды и два тупика.
 */
export type Decision = 'speak' | 'read' | 'known' | 'rejected';

/**
 * Решения → статусы в словаре.
 *
 * proposed, а НЕ accepted: accepted ставится только при экспорте. Иначе сбой
 * между отбором и выгрузкой оставит слово помеченным как добавленное, а
 * карточки не появится — и предложено оно больше никогда не будет.
 *
 * Слово попадает ровно в одну колоду: умение произнести включает умение
 * узнать, поэтому второй статус остаётся нетронутым, а не дублируется.
 */
export function applyDecisions(
  dict: Map<string, DictEntry>,
  decisions: Record<string, Decision>,
): number {
  let n = 0;
  for (const [lemma, choice] of Object.entries(decisions)) {
    const e = dict.get(lemma);
    if (!e) continue;
    if (choice === 'speak') e.speak = 'proposed';
    else if (choice === 'read') e.read = 'proposed';
    else { e.speak = choice; e.read = choice; }
    n++;
  }
  return n;
}

/**
 * Откат решений прохода: всё, что они выставили, снова становится `new`.
 *
 * `accepted` не трогаем никогда: карточка уже уехала в Noji, откуда её не
 * забрать. Вернув такому слову статус `new`, мы предложили бы его повторно.
 */
export function revertDecisions(
  dict: Map<string, DictEntry>,
  decisions: Record<string, Decision>,
): number {
  let n = 0;
  for (const lemma of Object.keys(decisions)) {
    const e = dict.get(lemma);
    if (!e) continue;
    if (e.speak !== 'accepted' && e.speak !== 'new') { e.speak = 'new'; n++; }
    if (e.read !== 'accepted' && e.read !== 'new') { e.read = 'new'; n++; }
  }
  return n;
}
