import { readFileSync } from 'node:fs';
import { extname, basename } from 'node:path';
import { parseOffice } from 'officeparser';
import { normalizeText, countWords } from './normalize.js';

export interface DocMeta {
  title: string | null;
  author: string | null;
  format: string;
  wordCount: number;
  charCount: number;
}

/** Всё сериализуемо в JSON — условие для будущей веб-версии. */
export interface Document {
  text: string;
  meta: DocMeta;
  warnings: string[];
}

/** officeparser поддерживает всё это; txt в списке нет и разбирается отдельно. */
const OFFICE_FORMATS = new Set([
  '.epub', '.docx', '.rtf', '.odt', '.md', '.html', '.htm', '.pdf',
]);

interface Node {
  type: string;
  text?: string;
  metadata?: Record<string, unknown>;
  children?: Node[];
}

const BLOCK_TYPES = new Set(['paragraph', 'heading', 'list', 'blockquote', 'table', 'code']);

/**
 * Текст узла AST.
 * ВАЖНО: у части узлов (list) поле `text` дублирует содержимое `children`.
 * Берём `text` только у листьев, иначе текст задваивается и портит частотность.
 */
function nodeText(n: Node): string {
  if (n.type === 'break') {
    return n.metadata?.breakType === 'textWrapping' ? ' ' : '';
  }
  if (n.children?.length) return n.children.map(nodeText).join('');
  return n.text ?? '';
}

/**
 * Собирает блоки в единое полотно.
 * Нормализация ПОБЛОЧНО, до склейки — см. joinHyphenated в normalize.ts.
 */
function assemble(blocks: string[]): string {
  return blocks.map(normalizeText).filter(Boolean).join('\n\n');
}

async function readOffice(path: string) {
  const r = (await parseOffice(path)) as {
    content: Node[];
    metadata?: { title?: string; author?: string };
    warnings?: unknown[];
  };
  const blocks = r.content
    .filter((n) => BLOCK_TYPES.has(n.type))
    .map((n) => nodeText(n));
  return {
    blocks,
    title: r.metadata?.title ?? null,
    author: r.metadata?.author ?? null,
    warnings: (r.warnings ?? []).map((w) => (typeof w === 'string' ? w : JSON.stringify(w))),
  };
}

export async function ingest(path: string): Promise<Document> {
  const ext = extname(path).toLowerCase();
  let blocks: string[];
  let title: string | null = null;
  let author: string | null = null;
  const warnings: string[] = [];

  if (ext === '.txt') {
    // officeparser txt не поддерживает — парсить тут нечего, читаем напрямую
    blocks = readFileSync(path, 'utf8').split(/\r?\n[ \t]*\r?\n/);
    title = basename(path, ext);
  } else if (OFFICE_FORMATS.has(ext)) {
    const r = await readOffice(path);
    ({ blocks, title, author } = r);
    warnings.push(...r.warnings);
  } else {
    throw new Error(
      `Формат ${ext} не поддерживается. Доступны: .txt, ${[...OFFICE_FORMATS].join(', ')}`,
    );
  }

  const text = assemble(blocks);
  if (!text) throw new Error('Из файла не извлечено ни одного блока текста');

  return {
    text,
    meta: {
      title,
      author,
      format: ext.slice(1),
      wordCount: countWords(text),
      charCount: text.length,
    },
    warnings,
  };
}