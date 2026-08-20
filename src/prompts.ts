import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * Промпты живут в prompts/*.md, а типы и подстановка — здесь.
 *
 * Почему не JSON: многострочный текст в нём превращается в "строка\nстрока",
 * комментариев нет, а diff в git становится бесполезным — правка одного слова
 * помечает всю строку изменённой. Markdown читается и правится как текст.
 *
 * Почему обёртка в TS, а не просто чтение файла: промпт и парсер связаны
 * контрактом. Промпт требует ответа вида [{"sense":…, "front":…}], а тип
 * RawCard в generate.ts его разбирает. Меняешь одно — обязан менять другое.
 * Функции ниже делают эту связь видимой и проверяемой компилятором.
 */

const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'prompts');

const cache = new Map<string, string>();

function load(name: string): string {
  let t = cache.get(name);
  if (t === undefined) {
    t = readFileSync(join(DIR, `${name}.md`), 'utf8').trim();
    cache.set(name, t);
  }
  return t;
}

/**
 * Подстановка {{key}}.
 * Незакрытый плейсхолдер после подстановки — ошибка: значит в шаблоне
 * опечатка или забыли передать поле. Молча отправлять такое в модель нельзя.
 */
function render(template: string, vars: Record<string, string>): string {
  const out = template.replace(/\{\{(\w+)\}\}/g, (_, k: string) => {
    if (!(k in vars)) throw new Error(`В шаблоне нет значения для {{${k}}}`);
    return vars[k];
  });
  const leftover = out.match(/\{\{\w+\}\}/);
  if (leftover) throw new Error(`Незаполненный плейсхолдер ${leftover[0]}`);
  return out;
}

// ─── системные промпты ─────────────────────────────────────────────────

export const speakSystem = () => load('speak-cards');
export const readSystem = () => load('read-cards');
export const fixSystem = () => load('fix-card');
export const fillBlankSystem = () => load('fill-blank');

// ─── пользовательские сообщения ────────────────────────────────────────

export function wordPrompt(v: { lemma: string; pos: string; contexts: string[] }): string {
  return render(load('user-word'), {
    lemma: v.lemma,
    pos: v.pos,
    contexts: v.contexts.map((c, i) => `${i + 1}. ${c}`).join('\n'),
  });
}

export function fixPrompt(v: {
  lemma: string;
  pos: string;
  sense: string | null;
  front: string;
  back: string;
  answer: string;
  problems: string[];
}): string {
  return render(load('user-fix'), {
    lemma: v.lemma,
    pos: v.pos,
    sense: v.sense ?? 'единственное',
    front: v.front,
    back: v.back,
    answer: v.answer,
    problems: v.problems.join('\n'),
  });
}