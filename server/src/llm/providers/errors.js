/**
 * Normalised provider failure. `code` drives the retry policy in the client:
 *   RATE_LIMITED     -> wait (Retry-After if given) and retry the same provider
 *   QUOTA_EXHAUSTED  -> daily/long quota gone: switch to the next provider
 *   SERVER / TIMEOUT -> transient: back off and retry
 *   AUTH / BAD_REQUEST -> not retryable on this provider
 */
export class ProviderError extends Error {
  constructor(code, message, { retryAfterMs, status } = {}) {
    super(message);
    this.code = code;
    this.retryAfterMs = retryAfterMs;
    this.status = status;
  }
}

export async function postJson(url, { headers, body, timeoutMs = 90_000 }) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal: ctrl.signal });
    const raw = await res.text();
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      data = { raw };
    }
    return { res, data };
  } catch (e) {
    if (e.name === 'AbortError') throw new ProviderError('TIMEOUT', `Provider did not answer within ${timeoutMs} ms`);
    throw new ProviderError('SERVER', `Network error talking to provider: ${e.message}`);
  } finally {
    clearTimeout(timer);
  }
}

export function parseDelay(value) {
  if (value == null) return undefined;
  const m = String(value).match(/([\d.]+)\s*(ms|s|m)?/);
  if (!m) return undefined;
  const n = Number(m[1]);
  const unit = m[2] || 's';
  return Math.ceil(unit === 'ms' ? n : unit === 'm' ? n * 60_000 : n * 1000);
}
