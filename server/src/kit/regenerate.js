import { AppError } from '../lib/errors.js';
import { isProtected, afterQuestionsChanged } from './mutations.js';
import { planCategories, CATEGORIES } from '../pipeline/categoryPlanner.js';
import { generateCategoryQuestions, templateQuestion } from '../pipeline/generateQuestions.js';
import { findGaps } from '../pipeline/coverage.js';
import { buildCompanyBrief } from '../pipeline/companyBrief.js';
import { buildSchedule } from '../pipeline/scheduler.js';

/**
 * Regeneration runs in two phases so a slow model call can't clobber edits made meanwhile:
 *
 *   compute*(snapshot)  -> slow, calls the model against a snapshot of the kit
 *   apply*(freshKit, r) -> fast, pure; re-reads protection flags from the LATEST kit
 *
 * The job runner calls apply* inside an optimistic-concurrency retry loop, so a question
 * edited while its category was regenerating is protected at merge time and survives.
 */

export async function computeCategoryRegeneration(kit, category, { llm }) {
  if (!CATEGORIES.includes(category)) throw new AppError('INVALID_CATEGORY', `Unknown category ${category}.`);
  const reqs = kit.role.requirements;
  const plan = planCategories({ requirements: reqs, seniority: kit.role.seniority, signals: kit.research?.hiring_signals || {} });
  const entry = plan.find((p) => p.category === category) || {
    category,
    requirement_ids: category === 'behavioural' ? reqs.filter((r) => r.kind === 'behavioural').map((r) => r.id) : reqs.filter((r) => r.kind !== 'behavioural').map((r) => r.id),
    count: 3,
  };
  const reqById = new Map(reqs.map((r) => [r.id, r]));
  const kept = kit.questions.filter((q) => q.category === category && isProtected(q));
  const others = kit.questions.filter((q) => q.category !== category);
  const count = Math.max(1, entry.count - kept.length);
  const questions = await generateCategoryQuestions({
    llm,
    category,
    requirements: entry.requirement_ids.map((id) => reqById.get(id)).filter(Boolean),
    allRequirements: reqs,
    count,
    role: kit.role,
    brief: kit.company_brief,
    signals: kit.research?.hiring_signals || {},
    existing: [...kept, ...others],
  });
  return { category, questions, requirement_ids: entry.requirement_ids };
}

export function applyCategoryRegeneration(kit, { category, questions, requirement_ids }) {
  const k = structuredClone(kit);
  const replaced = k.questions.filter((q) => q.category === category && !isProtected(q)).map((q) => q.id);
  const keptCount = k.questions.filter((q) => q.category === category && isProtected(q)).length;
  // Insert new questions where the category's first replaced question was, to keep ordering stable.
  const firstIdx = k.questions.findIndex((q) => replaced.includes(q.id));
  k.questions = k.questions.filter((q) => !replaced.includes(q.id));
  k.builder_state ??= {};
  let n = Math.max(k.builder_state.next_question ?? 1, ...kit.questions.map((q) => Number(q.id.slice(1)) + 1));
  const fresh = questions.map((q) => ({
    id: `q${n++}`,
    requirement_ids: q.requirement_ids,
    category,
    prompt: q.prompt,
    answer_outline: q.answer_outline,
    difficulty: q.difficulty,
    meta: { origin: 'generated', edited: false, pinned: false, regenerated_at: new Date().toISOString() },
  }));
  const at = firstIdx < 0 ? k.questions.length : Math.min(firstIdx, k.questions.length);
  k.questions.splice(at, 0, ...fresh);

  // The replaced questions may have been the only cover for some requirement: re-check,
  // and fall back to a labelled template rather than leave a must-have uncovered.
  const templated = [];
  for (const g of findGaps(k.role.requirements, k.questions)) {
    if (!requirement_ids.includes(g.id)) continue;
    const t = templateQuestion(g);
    k.questions.push({ id: `q${n++}`, ...t, category, template: undefined, meta: { origin: 'template', edited: false, pinned: false } });
    templated.push(g.id);
  }
  k.builder_state.next_question = n;
  afterQuestionsChanged(k);
  return { kit: k, summary: { replaced: replaced.length, kept: keptCount, added: fresh.length, templated } };
}

export async function computeBriefRegeneration(kit, { llm, cache }) {
  if (kit.company_brief?.meta?.pinned) throw new AppError('SECTION_PINNED', 'The company brief is pinned. Unpin it to regenerate.', { status: 409 });
  const pages = cache?.pages || [];
  const hiring = cache?.hiring || { found: false, stages: [], signals: {}, summary: kit.company_brief.hiring_process };
  return buildCompanyBrief({
    companyName: kit.source.company,
    companyUrl: kit.source.company_url,
    pages,
    crawl: { failures: cache?.crawl_failures || [] },
    hiring,
    discussion: cache?.discussion,
    jd: cache?.jd || '',
    llm,
  });
}

export function applyBriefRegeneration(kit, brief) {
  if (kit.company_brief?.meta?.pinned) throw new AppError('SECTION_PINNED', 'The company brief was pinned while regenerating; your version was kept.', { status: 409 });
  const k = structuredClone(kit);
  k.company_brief = {
    summary: brief.summary,
    what_they_do: brief.what_they_do,
    sources: brief.sources,
    hiring_process: brief.hiring_process,
    hiring_stages: brief.hiring_stages,
    talking_points: brief.talking_points,
    unknowns: brief.unknowns,
    public_discussion: brief.public_discussion,
    meta: { origin: 'generated', edited: false, pinned: false, regenerated_at: new Date().toISOString() },
  };
  return { kit: k, summary: { replaced: 1 } };
}

export function regenerateSchedule(kit, { days } = {}) {
  if (kit.schedule?.meta?.pinned) throw new AppError('SECTION_PINNED', 'The schedule is pinned. Unpin it to regenerate.', { status: 409 });
  const k = structuredClone(kit);
  k.schedule = buildSchedule({ questions: k.questions, requirements: k.role.requirements, days: days ?? k.schedule.days_available });
  k.schedule.meta = { origin: 'generated', edited: false, pinned: false, regenerated_at: new Date().toISOString() };
  return { kit: k, summary: { days: k.schedule.days.length } };
}
