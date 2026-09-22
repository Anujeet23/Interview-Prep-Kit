import { ProviderError, postJson, parseDelay } from './errors.js';

const BASES = {
  groq: 'https://api.groq.com/openai/v1/chat/completions',
  openrouter: 'https://openrouter.ai/api/v1/chat/completions',
};

/** Groq, OpenRouter, or anything else that speaks the OpenAI chat-completions protocol. */
export function openAICompatibleProvider({ kind, apiKey, model }) {
  return {
    name: `${kind}:${model}`,
    async complete({ system, messages, maxTokens = 2048, temperature = 0.3, json = true }) {
      const body = {
        model,
        temperature,
        max_tokens: maxTokens,
        messages: [{ role: 'system', content: system }, ...messages],
      };
      if (json) body.response_format = { type: 'json_object' };
      const { res, data } = await postJson(BASES[kind], { headers: { authorization: `Bearer ${apiKey}` }, body });
      if (!res.ok) {
        const msg = data?.error?.message || data?.raw || `HTTP ${res.status}`;
        if (res.status === 429) {
          const wait = parseDelay(res.headers.get('retry-after')) ?? parseDelay(msg.match(/try again in ([\d.]+m?s?)/i)?.[1]);
          // A multi-minute wait or a per-day limit means this provider is done for now.
          const quota = /per day|TPD|RPD|daily/i.test(msg) || (wait ?? 0) > 90_000;
          throw new ProviderError(quota ? 'QUOTA_EXHAUSTED' : 'RATE_LIMITED', msg, { retryAfterMs: wait, status: 429 });
        }
        if (res.status === 401 || res.status === 403) throw new ProviderError('AUTH', msg, { status: res.status });
        if (res.status >= 500) throw new ProviderError('SERVER', msg, { status: res.status });
        throw new ProviderError('BAD_REQUEST', msg, { status: res.status });
      }
      const choice = data.choices?.[0];
      const text = choice?.message?.content || '';
      if (!text) throw new ProviderError('BAD_RESPONSE', 'Empty response from provider');
      return { text, truncated: choice?.finish_reason === 'length', usage: data.usage };
    },
  };
}
