#!/usr/bin/env node
/**
 * Batch entry point (brief section 9):
 *   npm run evaluate -- --input <cases.json> --output <kits.json> [--concurrency 2] [--mock]
 *
 * Runs the exact pipeline the web app uses on every case, records failures instead of
 * aborting, and rewrites the output file after each case so a crash never loses finished work.
 */
import fs from 'node:fs/promises';
import path from 'node:path';

function parseArgs(argv) {
  const args = { concurrency: 2 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--input') args.input = argv[++i];
    else if (a === '--output') args.output = argv[++i];
    else if (a === '--concurrency') args.concurrency = Math.max(1, Number(argv[++i]) || 1);
    else if (a === '--mock') args.mock = true;
    else if (a === '--help' || a === '-h') args.help = true;
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
if (args.help || !args.input || !args.output) {
  console.error('Usage: npm run evaluate -- --input <cases.json> --output <kits.json> [--concurrency N] [--mock]');
  process.exit(args.help ? 0 : 2);
}

// Evaluation sites may be served from localhost; the web app keeps these blocked in production.
if (process.env.ALLOW_PRIVATE_URLS === undefined) process.env.ALLOW_PRIVATE_URLS = 'true';
if (args.mock) process.env.LLM_PROVIDERS = 'mock';

const { createPipelineDeps } = await import('../src/pipeline/deps.js');
const { runPipeline } = await import('../src/pipeline/runPipeline.js');

const CASE_HARD_TIMEOUT_MS = Number(process.env.CASE_TIMEOUT_MS || 280_000);

let cases;
try {
  cases = JSON.parse(await fs.readFile(path.resolve(args.input), 'utf8'));
  if (!Array.isArray(cases)) throw new Error('input must be a JSON array of cases');
} catch (e) {
  console.error(`Could not read ${args.input}: ${e.message}`);
  process.exit(2);
}

const { llm, fetcher, config } = createPipelineDeps({
  onLLMEvent: (e) => e.type === 'retry' && console.error(`  … ${e.task}: ${e.code} from ${e.provider}, waiting ${Math.round(e.wait_ms / 1000)}s`),
});
if (!llm.available()) {
  console.error('WARNING: no LLM provider configured (set GEMINI_API_KEY or GROQ_API_KEY, see .env.example).');
  console.error('         Kits will be built with the rule-based fallback only.');
} else {
  console.error(`LLM providers: ${llm.providers.join(' -> ')}`);
}

const out = { version: '1.0', generated_at: new Date().toISOString(), kits: [] };
const results = new Map();

async function writeOutput() {
  out.kits = cases.map((c, i) => results.get(i)).filter(Boolean);
  const tmp = `${args.output}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(out, null, 2));
  await fs.rename(tmp, args.output);
}

async function runCase(c, i) {
  const id = c?.id ?? `case-${i + 1}`;
  const t0 = Date.now();
  let timer;
  try {
    const { kit } = await Promise.race([
      runPipeline({ jd: c?.jd, company_url: c?.company_url, days: c?.days }, { llm, fetcher, config }),
      new Promise((_, rej) => {
        timer = setTimeout(() => rej(Object.assign(new Error(`Case exceeded ${CASE_HARD_TIMEOUT_MS / 1000}s`), { code: 'TIMEOUT' })), CASE_HARD_TIMEOUT_MS);
      }),
    ]);
    results.set(i, { id, status: 'ok', kit, error: null });
    const reqs = kit.role.requirements;
    console.error(
      `✓ ${id}: ${reqs.length} reqs (${reqs.filter((r) => r.priority === 'must').length} must), ${kit.questions.length} questions, ` +
        `${kit.coverage.passes} coverage passes, ${kit.schedule.days.length} days, hiring page: ${kit.research.hiring_page_found ? 'yes' : 'no'} ` +
        `[${Math.round((Date.now() - t0) / 1000)}s]`
    );
  } catch (e) {
    results.set(i, { id, status: 'failed', kit: null, error: { code: e.code || 'PIPELINE_ERROR', message: e.message } });
    console.error(`✗ ${id}: ${e.code || 'PIPELINE_ERROR'}: ${e.message}`);
  } finally {
    clearTimeout(timer);
    await writeOutput();
  }
}

const started = Date.now();
console.error(`Running ${cases.length} case(s) with concurrency ${args.concurrency}…`);
let next = 0;
await Promise.all(
  Array.from({ length: Math.min(args.concurrency, cases.length) }, async () => {
    while (next < cases.length) {
      const i = next++;
      await runCase(cases[i], i);
    }
  })
);
await writeOutput();
const ok = out.kits.filter((k) => k.status === 'ok').length;
console.error(`Done: ${ok}/${cases.length} ok in ${Math.round((Date.now() - started) / 1000)}s, LLM calls: ${llm.stats.calls}, rate-limit waits: ${llm.stats.rate_limited}. Wrote ${args.output}`);
