import { assertFetchable, parseHttpUrl } from './urlGuard.js';
import { sleep } from '../lib/text.js';

export class FetchError extends Error {
  constructor(code, message, { status, retryable = false, retryAfterMs } = {}) {
    super(message);
    this.code = code;
    this.status = status;
    this.retryable = retryable;
    this.retryAfterMs = retryAfterMs;
  }
}

const REDIRECTS = new Set([301, 302, 303, 307, 308]);
const DEFAULT_TYPES = ['text/html', 'application/xhtml+xml', 'text/plain', 'application/xml', 'text/xml', 'application/json'];

async function readLimited(body, maxBytes) {
  if (!body) return { text: '', truncated: false };
  const reader = body.getReader();
  const chunks = [];
  let total = 0;
  let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      chunks.push(value.subarray(0, value.byteLength - (total - maxBytes)));
      truncated = true;
      await reader.cancel().catch(() => {});
      break;
    }
    chunks.push(value);
  }
  return { text: new TextDecoder('utf-8', { fatal: false }).decode(Buffer.concat(chunks)), truncated };
}

/**
 * A fetcher for untrusted URLs:
 *  - validates each redirect hop against the private-address guard
 *  - accepts only expected content types, caps body size, enforces a timeout
 *  - waits between requests to the same host, and backs off on 429/5xx/timeouts
 */
export function createFetcher({
  allowPrivate = false,
  timeoutMs = 10_000,
  maxBytes = 2_000_000,
  perHostDelayMs = 300,
  retries = 2,
  userAgent = 'InterviewPrepKitBot/1.0',
  fetchImpl = globalThis.fetch,
  lookup,
} = {}) {
  const lastHit = new Map();
  const stats = { requests: 0 };

  async function politeWait(host, extraDelayMs = 0) {
    const gap = Math.max(perHostDelayMs, extraDelayMs);
    const wait = (lastHit.get(host) ?? 0) + gap - Date.now();
    lastHit.set(host, Date.now() + Math.max(0, wait));
    if (wait > 0) await sleep(wait);
  }

  async function fetchOnce(startUrl, { accept, types, hostDelayMs }) {
    let current = startUrl;
    for (let hop = 0; hop < 5; hop++) {
      await assertFetchable(current, { allowPrivate, lookup });
      await politeWait(current.host, hostDelayMs);
      stats.requests++;
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      let res;
      try {
        res = await fetchImpl(current.href, { redirect: 'manual', signal: ctrl.signal, headers: { 'user-agent': userAgent, accept } });
      } catch (e) {
        clearTimeout(timer);
        const timeout = e?.name === 'AbortError';
        throw new FetchError(timeout ? 'TIMEOUT' : 'NETWORK', timeout ? `Timed out after ${timeoutMs} ms` : `Network error: ${e?.cause?.code || e.message}`, { retryable: true });
      }
      try {
        if (REDIRECTS.has(res.status)) {
          const loc = res.headers.get('location');
          if (!loc) throw new FetchError('BAD_REDIRECT', 'Redirect without a location header');
          current = new URL(loc, current);
          if (!['http:', 'https:'].includes(current.protocol)) throw new FetchError('BAD_REDIRECT', 'Redirect to a non-http URL');
          continue;
        }
        if (!res.ok) {
          const ra = Number(res.headers.get('retry-after'));
          throw new FetchError(`HTTP_${res.status}`, `HTTP ${res.status}`, {
            status: res.status,
            retryable: res.status === 429 || res.status >= 500,
            retryAfterMs: Number.isFinite(ra) && ra > 0 ? ra * 1000 : undefined,
          });
        }
        const contentType = (res.headers.get('content-type') || '').toLowerCase();
        if (contentType && !types.some((t) => contentType.includes(t))) {
          throw new FetchError('UNSUPPORTED_TYPE', `Skipped: content type ${contentType.split(';')[0]}`);
        }
        const declared = Number(res.headers.get('content-length') || 0);
        if (declared > maxBytes * 4) throw new FetchError('TOO_LARGE', `Skipped: ${declared} bytes is too large`);
        const { text, truncated } = await readLimited(res.body, maxBytes);
        return { url: current.href, status: res.status, contentType, body: text, truncated };
      } catch (e) {
        if (e instanceof FetchError) throw e;
        if (e?.name === 'AbortError') throw new FetchError('TIMEOUT', `Timed out after ${timeoutMs} ms`, { retryable: true });
        throw new FetchError('NETWORK', e.message, { retryable: true });
      } finally {
        clearTimeout(timer);
      }
    }
    throw new FetchError('TOO_MANY_REDIRECTS', 'Too many redirects');
  }

  async function get(rawUrl, { accept = 'text/html,application/xhtml+xml;q=0.9,text/plain;q=0.8', types = DEFAULT_TYPES, retries: r = retries, hostDelayMs = 0 } = {}) {
    const url = rawUrl instanceof URL ? rawUrl : parseHttpUrl(rawUrl);
    let attempt = 0;
    for (;;) {
      try {
        return await fetchOnce(url, { accept, types, hostDelayMs });
      } catch (e) {
        const retryable = e instanceof FetchError && e.retryable;
        if (!retryable || attempt >= r) {
          e.attempts = attempt + 1;
          throw e;
        }
        attempt++;
        const backoff = e.retryAfterMs ?? Math.min(8000, 500 * 2 ** attempt) + Math.random() * 250;
        await sleep(Math.min(backoff, 15_000));
      }
    }
  }

  return { get, stats };
}
