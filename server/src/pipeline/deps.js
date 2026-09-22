import { getConfig } from '../config.js';
import { createFetcher } from '../retrieval/httpFetch.js';
import { createLLMFromEnv } from '../llm/client.js';

/** Wires the pipeline's dependencies from the environment. The web app and the batch command both use this. */
export function createPipelineDeps({ onLLMEvent } = {}) {
  const config = getConfig();
  const fetcher = createFetcher({
    allowPrivate: config.allowPrivateUrls,
    timeoutMs: config.crawl.timeoutMs,
    maxBytes: config.crawl.maxBytes,
    perHostDelayMs: config.crawl.perHostDelayMs,
    retries: config.crawl.retries,
    userAgent: config.crawl.userAgent,
  });
  const llm = createLLMFromEnv({ onEvent: onLLMEvent });
  return { config, fetcher, llm };
}
