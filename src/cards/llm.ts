/**
 * Порт для LLM.
 *
 * Интерфейс, а не прямой вызов клиента: тесты подставляют заглушку,
 * а веб-версия сможет проксировать запрос через свой бэкенд, не трогая
 * логику генерации.
 */

export interface LlmPort {
  /** Промпт → текст ответа. */
  complete(system: string, user: string): Promise<string>;
}

import { tuning } from '../config/index.js';

export class AnthropicLlm implements LlmPort {
  constructor(private apiKey = process.env.ANTHROPIC_API_KEY ?? '') {
    if (!this.apiKey) throw new Error('Нужен ANTHROPIC_API_KEY в окружении');
  }

  async complete(system: string, user: string): Promise<string> {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: tuning.generation.model,
        max_tokens: tuning.generation.maxTokens,
        system,
        messages: [{ role: 'user', content: user }],
      }),
    });

    if (!res.ok) {
      throw new Error(`Anthropic API ${res.status}: ${(await res.text()).slice(0, 200)}`);
    }

    const data = (await res.json()) as { content: Array<{ type: string; text?: string }> };
    return data.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text ?? '')
      .join('');
  }
}

/**
 * Достаёт JSON из ответа модели.
 *
 * Просто взять всё от первой скобки до конца строки нельзя: модель
 * регулярно дописывает пояснение после JSON или возвращает несколько
 * объектов подряд вместо массива. Поэтому считаем баланс скобок и берём
 * ровно один сбалансированный фрагмент, игнорируя скобки внутри строк.
 */
function balancedSlice(s: string, from: number): string | null {
  const open = s[from];
  const close = open === '[' ? ']' : '}';
  let depth = 0;
  let inStr = false;
  let esc = false;

  for (let i = from; i < s.length; i++) {
    const c = s[i];
    if (esc) { esc = false; continue; }
    if (c === '\\') { esc = true; continue; }
    if (c === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) return s.slice(from, i + 1);
    }
  }
  return null;
}

export function extractJson<T>(raw: string): T {
  const cleaned = raw.replace(/```json\s*|```/g, '').trim();

  const chunks: unknown[] = [];
  let pos = 0;
  while (pos < cleaned.length) {
    const start = cleaned.slice(pos).search(/[[{]/);
    if (start === -1) break;
    const abs = pos + start;
    const slice = balancedSlice(cleaned, abs);
    if (!slice) break;
    try {
      chunks.push(JSON.parse(slice));
    } catch {
      // невалидный фрагмент пропускаем и ищем следующий
    }
    pos = abs + slice.length;
  }

  if (!chunks.length) {
    throw new Error(`В ответе нет валидного JSON: ${raw.slice(0, 160)}`);
  }
  // Несколько объектов подряд вместо массива — собираем в массив.
  if (chunks.length > 1 && chunks.every((c) => !Array.isArray(c))) {
    return chunks as T;
  }
  return chunks[0] as T;
}