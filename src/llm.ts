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

const MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 2000;

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
        model: MODEL,
        max_tokens: MAX_TOKENS,
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

/** Достаёт JSON из ответа: модель иногда оборачивает его в ```json. */
export function extractJson<T>(raw: string): T {
  const cleaned = raw.replace(/```json\s*|```/g, '').trim();
  const start = cleaned.search(/[[{]/);
  if (start === -1) throw new Error(`В ответе нет JSON: ${raw.slice(0, 120)}`);
  return JSON.parse(cleaned.slice(start)) as T;
}