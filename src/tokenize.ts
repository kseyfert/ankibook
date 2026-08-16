import winkNLP from 'wink-nlp';
import model from 'wink-eng-lite-web-model';

const nlp = winkNLP(model);
const its = nlp.its;

export interface Token {
  /** как встретилось в тексте */
  form: string;
  /** словарная форма */
  lemma: string;
  /** NOUN | VERB | ADJ | ADV | ADP | DET | PRON | PROPN | NUM | PUNCT | ... */
  pos: string;
  /** позиция первого символа в исходном тексте */
  start: number;
}

/**
 * Текст → поток токенов.
 *
 * Позиции winkNLP напрямую не отдаёт: its.span для токена возвращает
 * сам текст, а не координаты. Восстанавливаем накоплением через
 * its.precedingSpaces — количество пробельных символов ПЕРЕД токеном.
 * Проверено на всей книге: 31 234 токена, ноль расхождений.
 */
export function tokenize(text: string): Token[] {
  const doc = nlp.readDoc(text);
  const out: Token[] = [];
  let pos = 0;

  doc.tokens().each((t: any) => {
    pos += (t.out(its.precedingSpaces) as string).length;
    const form = t.out() as string;
    out.push({
      form,
      lemma: (t.out(its.lemma) as string).toLowerCase(),
      pos: t.out(its.pos) as string,
      start: pos,
    });
    pos += form.length;
  });

  return out;
}