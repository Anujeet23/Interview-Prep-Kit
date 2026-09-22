import { extractRequirements } from './extractRequirements.js';
import { crawlCompany } from '../retrieval/crawler.js';
import { searchDiscussion } from '../retrieval/discussion.js';
import { analyseHiringProcess } from './hiringProcess.js';
import { buildCompanyBrief } from './companyBrief.js';
import { planCategories } from './categoryPlanner.js';
import { generateCategoryQuestions } from './generateQuestions.js';
import { closeCoverageGaps } from './coverage.js';
import { generateFlashcards, cardsFromQuestions } from './flashcards.js';
import { buildSchedule, validateDays } from './scheduler.js';
import { validateKit } from '../kit/schema.js';
import { AppError } from '../lib/errors.js';
import { collapse } from '../lib/text.js';

export const STEPS = [
  ['extract', 'Reading the job description'],
  ['crawl', 'Crawling the company site'],
  ['discussion', 'Searching public interview discussion'],
  ['hiring', 'Reading the hiring process'],
  ['brief', 'Writing the company brief'],
  ['questions', 'Generating questions, one category at a time'],
  ['coverage', 'Checking coverage and filling gaps'],
  ['flashcards', 'Making flashcards'],
  ['schedule', 'Allocating the study schedule'],
  ['finalise', 'Validating the kit'],
];

export function validateInput(input) {
  const jd = typeof input?.jd === 'string' ? input.jd.replace(/\r\n/g, '\n').trim() : '';
  if (jd.length < 10) throw new AppError('INVALID_INPUT', 'The job description is empty or too short to read.');
  if (jd.length > 50_000) throw new AppError('INVALID_INPUT', 'The job description is longer than 50,000 characters.');
  let days;
  try {
    days = validateDays(input.days);
  } catch (e) {
    throw new AppError('INVALID_INPUT', e.message);
  }
  const companyUrl = typeof input.company_url === 'string' ? input.company_url.trim() : '';
  return { jd, days, companyUrl };
}

export function companyNameFrom({ fromJd, pages, url }) {
  if (fromJd) return fromJd;
  const home = pages[0];
  if (home?.site_name) return home.site_name;
  if (home?.title) {
    const parts = home.title.split(/\s[|\-–—:·]\s/).map((s) => s.trim()).filter(Boolean);
    const short = parts.sort((a, b) => a.length - b.length)[0];
    if (short && short.length <= 40) return short;
  }
  try {
    const u = new URL(/^https?:/.test(url) ? url : `https://${url}`);
    const seg = u.pathname.split('/').filter(Boolean)[0];
    if (['localhost', '127.0.0.1'].includes(u.hostname) && seg) return seg.charAt(0).toUpperCase() + seg.slice(1);
    const label = u.hostname.replace(/^www\./, '').split('.')[0];
    return label.charAt(0).toUpperCase() + label.slice(1);
  } catch {
    return '';
  }
}

/**
 * The full research -> generation -> validation path. Used unchanged by the web app's job
 * runner and by `npm run evaluate`. Dependencies are injected so tests can run offline.
 *
 * Returns { kit, cache } where cache holds the cleaned research used by later
 * single-section regenerations (so regenerating a brief doesn't re-crawl).
 */
export async function runPipeline(input, { llm, fetcher, config, onProgress = () => {}, now = () => new Date() }) {
  const started = Date.now();
  const { jd, days, companyUrl } = validateInput(input);
  const budgetMs = config.pipelineBudgetMs ?? 170_000;
  const progress = (key, status, detail) => onProgress({ key, status, detail, at: new Date().toISOString() });
  const quality = { thin_jd: false, notes: [], degraded_steps: [] };

  // 1 + 2 run concurrently: reading pasted text needs no retrieval, the site needs crawling.
  progress('extract', 'running');
  progress('crawl', 'running', companyUrl);
  const [extraction, crawl] = await Promise.all([
    extractRequirements(jd, { llm }).then((r) => {
      progress('extract', 'done', `${r.role.requirements.length} requirements (${r.role.requirements.filter((x) => x.priority === 'must').length} must-have)`);
      return r;
    }),
    crawlCompany(companyUrl, {
      fetcher,
      userAgent: config.crawl.userAgent,
      maxPages: config.crawl.maxPages,
      deadline: started + Math.min(75_000, budgetMs * 0.45),
      onEvent: (e) => progress('crawl', 'running', e.url),
    }).then((c) => {
      const hiring = c.pages.filter((p) => p.is_hiring).length;
      progress('crawl', c.reachable ? 'done' : 'failed', c.reachable ? `${c.pages.length} pages read${hiring ? ', hiring page found' : ', no hiring page'}` : c.notes[0]);
      return c;
    }),
  ]);
  if (extraction.method === 'heuristic') quality.degraded_steps.push('extract');
  quality.thin_jd = extraction.thin;
  quality.notes.push(...extraction.notes, ...crawl.notes);

  const { role } = extraction;
  const companyName = companyNameFrom({ fromJd: extraction.company_from_jd, pages: crawl.pages, url: companyUrl });

  // 3. Public discussion (needs the company name, so after 1+2).
  progress('discussion', 'running', companyName);
  let domain = '';
  try {
    domain = new URL(crawl.base_url || (/^https?:/.test(companyUrl) ? companyUrl : `https://${companyUrl}`)).hostname.replace(/^www\./, '');
    if (/^(localhost|127\.|\d+\.\d+\.\d+\.\d+)/.test(domain)) domain = '';
  } catch {
    /* invalid URL already reported by the crawl */
  }
  const discussion = await searchDiscussion({
    companyName,
    domain,
    fetcher,
    enabled: config.discussion.enabled && Date.now() - started < budgetMs * 0.5,
    timeoutMs: config.discussion.timeoutMs,
    tavilyKey: config.discussion.tavilyKey,
  });
  progress('discussion', 'done', discussion.results.length ? `${discussion.results.length} relevant threads` : `nothing relevant (${discussion.status})`);
  if (!discussion.results.length) quality.notes.push(`Public discussion search: ${discussion.status === 'nothing_found' ? 'nothing relevant found' : discussion.status}.`);

  // 4. The hiring page, if found, changes what questions make sense.
  const hiringPages = crawl.pages.filter((p) => p.is_hiring);
  progress('hiring', 'running');
  const hiring = await analyseHiringProcess({ hiringPages, llm });
  progress('hiring', hiring.found ? 'done' : 'skipped', hiring.found ? `${hiring.stages.length} stages; ${Object.entries(hiring.signals).filter(([, v]) => v).map(([k]) => k).join(', ') || 'no format signals'}` : 'no published process');
  if (hiring.degraded) quality.degraded_steps.push('hiring');

  // 5. Company brief from what was actually retrieved.
  progress('brief', 'running');
  const brief = await buildCompanyBrief({ companyName, companyUrl, pages: crawl.pages, crawl, hiring, discussion, jd, llm });
  if (brief.degraded) quality.degraded_steps.push('brief');
  progress('brief', 'done');

  // 6. Questions: one call per category, each with its own instructions and requirement subset.
  const plan = planCategories({ requirements: role.requirements, seniority: role.seniority, signals: hiring.signals });
  const reqById = new Map(role.requirements.map((r) => [r.id, r]));
  let draft = [];
  for (const [i, p] of plan.entries()) {
    progress('questions', 'running', `${p.category} (${i + 1}/${plan.length})`);
    try {
      const qs = await generateCategoryQuestions({
        llm,
        category: p.category,
        requirements: p.requirement_ids.map((id) => reqById.get(id)),
        allRequirements: role.requirements,
        count: p.count,
        role,
        brief,
        signals: hiring.signals,
        existing: draft,
      });
      draft = draft.concat(qs.map((q) => ({ ...q, from_pass: 1 })));
    } catch (e) {
      quality.degraded_steps.push(`questions:${p.category}`);
      quality.notes.push(`Could not generate ${p.category} questions (${e.code || e.message}); the coverage pass will fill any gaps.`);
    }
  }
  progress('questions', 'done', `${draft.length} draft questions across ${plan.length} categories`);

  // 7. Second pass: deterministic gap check, targeted regeneration, check again.
  progress('coverage', 'running');
  const cov = await closeCoverageGaps({
    llm,
    requirements: role.requirements,
    questions: draft,
    role,
    brief,
    signals: hiring.signals,
    onPass: (p) => progress('coverage', 'running', `pass ${p.pass}: ${p.gaps.length ? `${p.gaps.length} uncovered (${p.gaps.join(', ')})` : 'all requirements covered'}`),
  });
  if (cov.templated.length) quality.notes.push(`The model did not cover ${cov.templated.join(', ')} after ${cov.passes - 1} passes; template questions were added and marked as such.`);
  progress('coverage', 'done', `${cov.passes} passes, ${cov.uncovered.length} uncovered`);

  const questions = cov.questions.map((q, i) => ({
    id: `q${i + 1}`,
    requirement_ids: q.requirement_ids,
    category: q.category,
    prompt: q.prompt,
    answer_outline: q.answer_outline,
    difficulty: q.difficulty,
    meta: { origin: q.template ? 'template' : 'generated', edited: false, pinned: false, pass: q.from_pass ?? 1 },
  }));

  // 8. Flashcards.
  progress('flashcards', 'running');
  let { cards, degraded: cardsDegraded } = await generateFlashcards({ llm, requirements: role.requirements, role });
  if (!cards.length && questions.length) {
    cards = cardsFromQuestions(questions);
    if (cardsDegraded) quality.degraded_steps.push('flashcards');
  }
  const flashcards = cards.map((c, i) => ({
    id: `f${i + 1}`,
    front: c.front,
    back: c.back,
    requirement_ids: c.requirement_ids,
    meta: { origin: 'generated', edited: false, pinned: false },
  }));
  progress('flashcards', 'done', `${flashcards.length} cards`);

  // 9. Schedule: arithmetic, in code.
  progress('schedule', 'running');
  const schedule = buildSchedule({ questions, requirements: role.requirements, days });
  schedule.meta = { origin: 'generated', edited: false, pinned: false };
  progress('schedule', 'done', `${days} day${days === 1 ? '' : 's'}`);

  // 10. Assemble + validate.
  progress('finalise', 'running');
  const location = extraction.location && jd.toLowerCase().includes(extraction.location.toLowerCase()) ? extraction.location : '';
  const kit = {
    source: {
      company: companyName,
      company_url: companyUrl,
      role: role.title,
      location,
      jd_chars: jd.length,
      researched_at: now().toISOString(),
      pages_used: crawl.pages.map((p) => p.url),
    },
    company_brief: {
      summary: brief.summary,
      what_they_do: brief.what_they_do,
      sources: brief.sources,
      hiring_process: brief.hiring_process,
      hiring_stages: brief.hiring_stages,
      talking_points: brief.talking_points,
      unknowns: brief.unknowns,
      public_discussion: brief.public_discussion,
      meta: { origin: 'generated', edited: false, pinned: false },
    },
    role: {
      title: role.title,
      seniority: role.seniority,
      responsibilities: role.responsibilities,
      requirements: role.requirements,
    },
    questions,
    flashcards,
    schedule,
    coverage: { uncovered_requirement_ids: cov.uncovered, passes: cov.passes, log: cov.log, templated_requirement_ids: cov.templated },
    research: {
      company_reachable: crawl.reachable,
      hiring_page_found: hiring.found,
      hiring_signals: hiring.signals,
      pages: crawl.pages.map((p) => ({ url: p.url, title: p.title, intent: p.intent, is_hiring: p.is_hiring })),
      failed_sources: crawl.failures,
      discussion: { status: discussion.status, sources_tried: discussion.sources_tried, results: discussion.results.length, failures: discussion.failures },
      category_plan: plan.map((p) => ({ category: p.category, requirement_ids: p.requirement_ids, requested: p.count })),
      dropped_requirements: extraction.dropped,
    },
    quality: { ...quality, notes: [...new Set(quality.notes)].map(collapse), elapsed_ms: Date.now() - started, llm_calls: llm.stats?.calls },
    builder_state: { next_question: questions.length + 1, next_flashcard: flashcards.length + 1 },
  };

  const check = validateKit(kit, { strict: true });
  if (!check.ok) {
    progress('finalise', 'failed', check.errors[0]);
    throw new AppError('KIT_INVALID', `Generated kit failed validation: ${check.errors.slice(0, 3).join('; ')}`, { status: 500, details: check.errors });
  }
  progress('finalise', 'done');

  const cache = {
    pages: crawl.pages.map((p) => ({ url: p.url, title: p.title, description: p.description, text: p.text.slice(0, 6000), is_hiring: p.is_hiring })),
    hiring,
    discussion: { status: discussion.status, results: discussion.results },
    crawl_failures: crawl.failures,
    company_name: companyName,
  };
  return { kit, cache };
}
