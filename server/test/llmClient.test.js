import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { createLLM } from '../src/llm/client.js';
import { RateLimiter } from '../src/llm/rateLimiter.js';
import { ProviderError } from '../src/llm/providers/errors.js';
import { parseJsonLoose } from '../src/llm/json.js';

const schema = z.object({ answer: z.number() });
const call = { task: 't', system: 's', user: 'u', schema, maxTokens: 100 };

function scripted(name, script) {
  let i = 0;
  const provider = {
    name,
    calls: 0,
    async complete() {
      provider.calls++;
      const step = script[Math.min(i++, script.length - 1)];
      if (step instanceof Error) throw step;
      return { text: step };
    },
  };
  return provider;
}
const slot = (provider) => ({ provider, limiter: new RateLimiter({ rpm: 1e6, tpm: 1e9 }) });

test('rate limit (429) is waited out using Retry-After, then succeeds', async () => {
  const waits = [];
  const p = scripted('a', [new ProviderError('RATE_LIMITED', 'slow down', { retryAfterMs: 1234 }), '{"answer": 42}']);
  const llm = createLLM({ slots: [slot(p)], sleep: async (ms) => waits.push(ms) });
  assert.deepEqual(await llm.generateJSON(call), { answer: 42 });
  assert.ok(waits.includes(1234));
  assert.equal(llm.stats.rate_limited, 1);
});

test('invalid JSON gets one repair round-trip with the validation error', async () => {
  const p = scripted('a', ['here you go: {"answer": "not a number"}', '```json\n{"answer": 7}\n```']);
  const llm = createLLM({ slots: [slot(p)], sleep: async () => {} });
  assert.deepEqual(await llm.generateJSON(call), { answer: 7 });
  assert.equal(llm.stats.repairs, 1);
});

test('exhausted quota switches to the next provider', async () => {
  const a = scripted('a', [new ProviderError('QUOTA_EXHAUSTED', 'daily limit')]);
  const b = scripted('b', ['{"answer": 1}']);
  const llm = createLLM({ slots: [slot(a), slot(b)], sleep: async () => {} });
  assert.deepEqual(await llm.generateJSON(call), { answer: 1 });
  await llm.generateJSON(call);
  assert.equal(a.calls, 1, 'disabled provider is not retried on the next call');
});

test('persistent failure becomes a single LLM_UNAVAILABLE error', async () => {
  const p = scripted('a', [new ProviderError('SERVER', 'boom')]);
  const llm = createLLM({ slots: [slot(p)], sleep: async () => {}, maxWaitMsPerCall: 1e9 });
  await assert.rejects(llm.generateJSON(call), (e) => e.code === 'LLM_UNAVAILABLE');
  assert.equal(p.calls, 7);
});

test('limiter enforces tokens-per-minute, not just requests', async () => {
  let t = 0;
  const lim = new RateLimiter({ rpm: 100, tpm: 1000, now: () => t, sleep: async (ms) => (t += ms) });
  await lim.acquire(600);
  await lim.acquire(600); // must wait for the first to leave the window
  assert.ok(t >= 60_000);
});

test('parseJsonLoose tolerates fences, prose and trailing commas', () => {
  assert.deepEqual(parseJsonLoose('Sure!\n```json\n{"a":1,}\n```'), { a: 1 });
  assert.deepEqual(parseJsonLoose('prefix {"a":[1,2,],} suffix'), { a: [1, 2] });
  assert.throws(() => parseJsonLoose('no json here'));
});
