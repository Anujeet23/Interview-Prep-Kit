import { log } from '../lib/logger.js';

/**
 * In-process FIFO queue. Concurrency is 1 by default because every job shares the same
 * rate-limited model provider: running two kits in parallel wouldn't finish either sooner.
 * State that matters (status, progress, results) lives in MongoDB, so a restart loses only
 * the in-flight job, which startup recovery marks as interrupted and retryable.
 */
export class JobQueue {
  constructor({ concurrency = 1 } = {}) {
    this.concurrency = concurrency;
    this.waiting = [];
    this.running = new Set();
  }

  push(id, fn) {
    if (this.running.has(id) || this.waiting.some((j) => j.id === id)) return false;
    this.waiting.push({ id, fn });
    this.drain();
    return true;
  }

  position(id) {
    if (this.running.has(id)) return 0;
    const i = this.waiting.findIndex((j) => j.id === id);
    return i < 0 ? null : i + 1;
  }

  drain() {
    while (this.running.size < this.concurrency && this.waiting.length) {
      const job = this.waiting.shift();
      this.running.add(job.id);
      Promise.resolve()
        .then(job.fn)
        .catch((e) => log.error(`job ${job.id} crashed`, e))
        .finally(() => {
          this.running.delete(job.id);
          this.drain();
        });
    }
  }
}

export const generationQueue = new JobQueue({ concurrency: Number(process.env.GENERATION_CONCURRENCY || 1) });
// Section regenerations are small; they get their own lane so they don't wait behind a full kit.
export const regenerationQueue = new JobQueue({ concurrency: 2 });
