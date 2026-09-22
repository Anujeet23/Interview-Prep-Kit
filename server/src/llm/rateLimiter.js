import { sleep as realSleep } from '../lib/text.js';

/**
 * Sliding-window limiter for one provider: requests per minute AND tokens per minute.
 * Free tiers cap tokens per minute, so counting requests alone is not enough.
 * `penalise(ms)` is called after a 429 so every caller waits, not just the one that was refused.
 */
export class RateLimiter {
  constructor({ rpm = 10, tpm = 100_000, now = Date.now, sleep = realSleep } = {}) {
    Object.assign(this, { rpm, tpm, now, sleep });
    this.events = [];
    this.blockedUntil = 0;
  }

  prune(t) {
    while (this.events.length && this.events[0].t <= t - 60_000) this.events.shift();
  }

  usage() {
    const t = this.now();
    this.prune(t);
    return { requests: this.events.length, tokens: this.events.reduce((s, e) => s + e.tokens, 0) };
  }

  /** Returns how long we must wait before a request of `tokens` fits (0 if it fits now). */
  waitTime(tokens) {
    const t = this.now();
    this.prune(t);
    if (t < this.blockedUntil) return this.blockedUntil - t;
    const used = this.events.reduce((s, e) => s + e.tokens, 0);
    const fitsTokens = used + tokens <= this.tpm || this.events.length === 0;
    if (this.events.length < this.rpm && fitsTokens) return 0;
    // Walk forward through expiries until both limits would be satisfied.
    let reqs = this.events.length;
    let tokensUsed = used;
    for (const e of this.events) {
      reqs--;
      tokensUsed -= e.tokens;
      if (reqs < this.rpm && (tokensUsed + tokens <= this.tpm || reqs === 0)) return e.t + 60_000 - t + 25;
    }
    return 60_000;
  }

  async acquire(tokens) {
    for (;;) {
      const w = this.waitTime(tokens);
      if (w <= 0) {
        this.events.push({ t: this.now(), tokens });
        return;
      }
      await this.sleep(w);
    }
  }

  penalise(ms) {
    this.blockedUntil = Math.max(this.blockedUntil, this.now() + ms);
  }
}

export const estimateTokens = (text) => Math.ceil(String(text || '').length / 3.5);
