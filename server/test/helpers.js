import { createLLM } from '../src/llm/client.js';
import { mockProvider } from '../src/llm/providers/mock.js';
import { RateLimiter } from '../src/llm/rateLimiter.js';

export function mockLLM(opts = {}) {
  return createLLM({ slots: [{ provider: mockProvider(opts), limiter: new RateLimiter({ rpm: 1e6, tpm: 1e12 }) }], sleep: async () => {} });
}

export function reqs(list) {
  return list.map(([priority, kind = 'technical', text], i) => ({ id: `r${i + 1}`, text: text || `skill ${i + 1}`, kind, priority }));
}

export function questionsFor(requirements, perReq = 1) {
  const qs = [];
  for (const r of requirements)
    for (let j = 0; j < perReq; j++)
      qs.push({ id: `q${qs.length + 1}`, requirement_ids: [r.id], category: r.kind === 'behavioural' ? 'behavioural' : 'technical', prompt: `Q about ${r.text} ${j}`, answer_outline: 'x', difficulty: (j % 3) + 1 });
  return qs;
}

export const TEST_CONFIG = {
  pipelineBudgetMs: 60_000,
  crawl: { userAgent: 'test-bot', maxPages: 8 },
  discussion: { enabled: false, timeoutMs: 1000, tavilyKey: '' },
};
