import { RateLimiter, estimateTokens } from './rateLimiter.js';
import { parseJsonLoose, describeZodError } from './json.js';
import { ProviderError } from './providers/errors.js';
import { geminiProvider } from './providers/gemini.js';
import { openAICompatibleProvider } from './providers/openaiCompatible.js';
import { mockProvider } from './providers/mock.js';
import { sleep as realSleep } from '../lib/text.js';
import { AppError } from '../lib/errors.js';
import { getConfig } from '../config.js';

const TRANSIENT = new Set(['RATE_LIMITED', 'SERVER', 'TIMEOUT', 'BAD_RESPONSE']);

/**
 * The only way the pipeline talks to a model.
 *
 * generateJSON() guarantees one of two outcomes: an object that passed the zod schema,
 * or an LLMError. In between it:
 *   - waits on a per-provider RPM + TPM limiter before every request
 *   - on 429 honours Retry-After (or backs off exponentially) and blocks the limiter for everyone
 *   - on invalid/truncated JSON sends the validation error back and asks for a corrected answer
 *   - when a provider's quota is gone (or it keeps failing) moves on to the next provider
 */
export function createLLM({ slots, maxWaitMsPerCall = 120_000, sleep = realSleep, onEvent = () => {} }) {
  const stats = { calls: 0, retries: 0, rate_limited: 0, repairs: 0, provider_switches: 0, by_task: {} };

  async function viaSlot(slot, { task, system, user, schema, data, maxTokens, temperature }) {
    const started = Date.now();
    let messages = [{ role: 'user', content: user }];
    let transient = 0;
    let repairs = 0;
    for (;;) {
      const est = estimateTokens(system + messages.map((m) => m.content).join('\n')) + maxTokens;
      await slot.limiter.acquire(Math.min(est, slot.limiter.tpm));
      stats.calls++;
      stats.by_task[task] = (stats.by_task[task] || 0) + 1;
      let out;
      try {
        out = await slot.provider.complete({ system, messages, maxTokens, temperature, json: true, task, data });
      } catch (e) {
        if (!(e instanceof ProviderError) || !TRANSIENT.has(e.code)) throw e;
        transient++;
        const wait = e.retryAfterMs ?? Math.min(30_000, 2000 * 2 ** (transient - 1)) + Math.floor(Math.random() * 500);
        if (e.code === 'RATE_LIMITED') {
          stats.rate_limited++;
          slot.limiter.penalise(wait);
        }
        if (transient > 6 || Date.now() - started + wait > maxWaitMsPerCall) throw e;
        stats.retries++;
        onEvent({ type: 'retry', task, provider: slot.provider.name, code: e.code, wait_ms: wait });
        await sleep(wait);
        continue;
      }
      try {
        return schema.parse(parseJsonLoose(out.text));
      } catch (err) {
        if (repairs >= 2) throw new ProviderError('INVALID_OUTPUT', `Model output failed validation ${repairs + 1} times: ${describeZodError(err) || err.message}`);
        repairs++;
        stats.repairs++;
        const why = describeZodError(err) || err.message;
        messages = [
          ...messages,
          { role: 'assistant', content: String(out.text).slice(0, 8000) },
          {
            role: 'user',
            content: `That reply could not be used: ${why}.${out.truncated ? ' It was cut off by the length limit, so return fewer items and keep each field short.' : ''} Reply again with only the corrected JSON object, nothing else.`,
          },
        ];
      }
    }
  }

  async function generateJSON({ task, system, user, schema, data, maxTokens = 2048, temperature = 0.3 }) {
    const errors = [];
    const usable = slots.filter((s) => !(s.disabledUntil > Date.now()));
    for (const [i, slot] of usable.entries()) {
      try {
        const result = await viaSlot(slot, { task, system, user, schema, data, maxTokens, temperature });
        if (i > 0) stats.provider_switches++;
        return result;
      } catch (e) {
        errors.push(`${slot.provider.name}: ${e.code || ''} ${e.message}`.trim());
        if (e.code === 'QUOTA_EXHAUSTED') slot.disabledUntil = Date.now() + 15 * 60_000;
        if (e.code === 'AUTH') slot.disabledUntil = Date.now() + 60 * 60_000;
        onEvent({ type: 'provider_failed', task, provider: slot.provider.name, code: e.code });
      }
    }
    throw new AppError('LLM_UNAVAILABLE', `No model provider produced a valid answer for "${task}". ${errors.join(' | ') || 'No provider is configured.'}`, { status: 503 });
  }

  return { generateJSON, stats, providers: slots.map((s) => s.provider.name), available: () => slots.length > 0 };
}

/** Build the client from environment configuration (see .env.example). */
export function createLLMFromEnv({ onEvent } = {}) {
  const cfg = getConfig().llm;
  const slots = [];
  for (const name of cfg.order) {
    if (name === 'mock') slots.push({ provider: mockProvider(), limiter: new RateLimiter({ rpm: 10_000, tpm: 1e9 }) });
    else if (name === 'gemini' && cfg.gemini.apiKey) slots.push({ provider: geminiProvider(cfg.gemini), limiter: new RateLimiter(cfg.gemini) });
    else if ((name === 'groq' || name === 'openrouter') && cfg[name].apiKey)
      slots.push({ provider: openAICompatibleProvider({ kind: name, ...cfg[name] }), limiter: new RateLimiter(cfg[name]) });
  }
  return createLLM({ slots, maxWaitMsPerCall: cfg.maxWaitMsPerCall, onEvent });
}
