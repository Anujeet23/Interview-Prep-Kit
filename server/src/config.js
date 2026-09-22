import dotenv from 'dotenv';

dotenv.config({ quiet: true });

const bool = (v, d = false) => (v === undefined || v === '' ? d : ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase()));
const num = (v, d) => (v === undefined || v === '' || Number.isNaN(Number(v)) ? d : Number(v));

/**
 * Configuration is read from the environment every time it is requested so that
 * tests and the batch command can adjust process.env before using a module.
 * Every variable is documented in .env.example.
 */
export function getConfig() {
  const env = process.env.NODE_ENV || 'development';
  return {
    env,
    isProd: env === 'production',
    port: num(process.env.PORT, 4000),
    mongoUri: process.env.MONGODB_URI || '',
    jwtSecret: process.env.JWT_SECRET || 'dev-only-insecure-secret',
    sessionDays: num(process.env.SESSION_DAYS, 7),
    appOrigins: (process.env.APP_ORIGIN || 'http://localhost:3000').split(',').map((s) => s.trim()).filter(Boolean),
    // Private/loopback addresses are blocked in production. The batch command turns them on
    // because the evaluation company sites are served from localhost.
    allowPrivateUrls: bool(process.env.ALLOW_PRIVATE_URLS, env !== 'production'),
    llm: {
      order: (process.env.LLM_PROVIDERS || 'gemini,groq').split(',').map((s) => s.trim()).filter(Boolean),
      maxWaitMsPerCall: num(process.env.LLM_MAX_WAIT_MS, 120_000),
      gemini: {
        apiKey: process.env.GEMINI_API_KEY || '',
        model: process.env.GEMINI_MODEL || 'gemini-3.6-flash',
        rpm: num(process.env.GEMINI_RPM, 8),
        tpm: num(process.env.GEMINI_TPM, 200_000),
      },
      groq: {
        apiKey: process.env.GROQ_API_KEY || '',
        model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
        rpm: num(process.env.GROQ_RPM, 25),
        tpm: num(process.env.GROQ_TPM, 11_000),
      },
      openrouter: {
        apiKey: process.env.OPENROUTER_API_KEY || '',
        model: process.env.OPENROUTER_MODEL || 'meta-llama/llama-3.3-70b-instruct:free',
        rpm: num(process.env.OPENROUTER_RPM, 15),
        tpm: num(process.env.OPENROUTER_TPM, 100_000),
      },
    },
    pipelineBudgetMs: num(process.env.PIPELINE_BUDGET_MS, 170_000),
    crawl: {
      maxPages: num(process.env.CRAWL_MAX_PAGES, 8),
      timeoutMs: num(process.env.CRAWL_TIMEOUT_MS, 10_000),
      maxBytes: num(process.env.CRAWL_MAX_BYTES, 2_000_000),
      perHostDelayMs: num(process.env.CRAWL_HOST_DELAY_MS, 300),
      retries: num(process.env.CRAWL_RETRIES, 2),
      userAgent: process.env.CRAWL_USER_AGENT || 'InterviewPrepKitBot/1.0 (+educational project; respects robots.txt)',
    },
    discussion: {
      enabled: bool(process.env.DISCUSSION_SEARCH, true),
      timeoutMs: num(process.env.DISCUSSION_TIMEOUT_MS, 7_000),
      tavilyKey: process.env.TAVILY_API_KEY || '',
    },
  };
}
