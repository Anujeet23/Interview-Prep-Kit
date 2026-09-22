import { Router } from 'express';
import crypto from 'node:crypto';
import { z } from 'zod';
import { Kit } from '../db/models/Kit.js';
import { mutate, getOwnedKit } from '../db/kitStore.js';
import { requireAuth } from '../auth/session.js';
import { parseBody } from './validate.js';
import { AppError } from '../lib/errors.js';
import { enqueueGeneration, enqueueRegeneration } from '../jobs/kitJobs.js';
import { generationQueue } from '../jobs/queue.js';
import { STEPS } from '../pipeline/runPipeline.js';
import { MAX_DAYS } from '../pipeline/scheduler.js';
import { CATEGORIES } from '../pipeline/categoryPlanner.js';
import { validateKit } from '../kit/schema.js';
import * as M from '../kit/mutations.js';
import { recordReview, sessionOrder, practiceSummary, storyCoverage } from '../kit/practice.js';

export const kitsRouter = Router();
kitsRouter.use(requireAuth);

// ---------- helpers ----------

const NewKit = z.object({
  jd: z.string().trim().min(10, 'Paste the job description (at least a sentence).').max(50_000, 'The job description is over 50,000 characters.'),
  company_url: z.string().trim().min(1, 'Enter the company website.').max(2000),
  days: z.coerce.number().int('Days must be a whole number.').min(1, 'Days must be at least 1.').max(MAX_DAYS, `Days can be at most ${MAX_DAYS}.`),
});

export function dedupeKey({ jd, company_url, days }) {
  const normJd = jd.toLowerCase().replace(/\s+/g, ' ').trim();
  const normUrl = company_url.toLowerCase().trim().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/+$/, '');
  return crypto.createHash('sha256').update(`${normJd}|${normUrl}|${days}`).digest('hex');
}

function summary(doc) {
  return {
    id: String(doc._id),
    status: doc.status,
    title: doc.title || firstLine(doc.input?.jd),
    company: doc.company || doc.input?.company_url,
    company_url: doc.input?.company_url,
    days: doc.input?.days,
    created_at: doc.createdAt,
    updated_at: doc.updatedAt,
    error: doc.error,
    questions: doc.kit?.questions?.length ?? null,
    uncovered: doc.kit?.coverage?.uncovered_requirement_ids?.length ?? null,
  };
}

const firstLine = (s) => String(s || '').split('\n').find((l) => l.trim())?.trim().slice(0, 80) || 'Untitled';

function view(doc) {
  return {
    ...summary(doc),
    input: doc.input,
    steps: STEPS.map(([key, label]) => ({ key, label })),
    progress: doc.progress,
    queue_position: doc.status === 'queued' || doc.status === 'running' ? generationQueue.position(String(doc._id)) : null,
    kit: doc.kit,
    stories: doc.stories,
    regenerating: doc.regenerating,
    last_regeneration: doc.lastRegeneration,
    rev: doc.rev,
  };
}

async function createKit(userId, input, { force = false } = {}) {
  const key = dedupeKey(input);
  const running = await Kit.findOne({ userId, activeKey: key }).lean();
  if (running) return { doc: running, duplicate: 'in_progress' };
  if (!force) {
    const done = await Kit.findOne({ userId, dedupeKey: key, status: 'ready' }).sort({ createdAt: -1 }).lean();
    if (done) return { doc: done, duplicate: 'exists' };
  }
  try {
    const doc = await Kit.create({ userId, input, dedupeKey: key, activeKey: key, status: 'queued', title: firstLine(input.jd), company: input.company_url });
    enqueueGeneration(doc._id);
    return { doc: doc.toObject(), duplicate: null };
  } catch (e) {
    if (e.code === 11000) {
      // Lost a race with an identical submit (double click): return the one that won.
      const winner = await Kit.findOne({ userId, activeKey: key }).lean();
      if (winner) return { doc: winner, duplicate: 'in_progress' };
    }
    throw e;
  }
}

/** Apply a pure mutation to the latest kit with optimistic concurrency, then validate. */
async function edit(req, res, fn, status = 200) {
  const { doc, extra } = await mutate(req.params.id, req.user.id, (d) => {
    if (d.status !== 'ready' || !d.kit) throw new AppError('KIT_NOT_READY', 'This kit is still being generated.', { status: 409 });
    const out = fn(d.kit, d);
    const kit = out.kit ?? out;
    const check = validateKit(kit, { strict: false });
    if (!check.ok) throw new AppError('INVALID_EDIT', `That change would break the kit: ${check.errors[0]}`, { status: 400, details: check.errors });
    return { set: { kit, ...(out.set || {}) }, extra: out.item };
  });
  res.status(status).json({ kit: doc.kit, item: extra ?? null, rev: doc.rev });
}

// ---------- kits ----------

kitsRouter.get('/', async (req, res) => {
  const docs = await Kit.find({ userId: req.user.id })
    .select('status input title company createdAt updatedAt error kit.coverage kit.questions.id')
    .sort({ updatedAt: -1 })
    .limit(100)
    .lean();
  res.json({ kits: docs.map(summary) });
});

kitsRouter.post('/', async (req, res) => {
  const input = parseBody(NewKit, req.body);
  const { doc, duplicate } = await createKit(req.user.id, input, { force: req.body?.force === true });
  res.status(duplicate ? 200 : 202).json({ kit: summary(doc), duplicate });
});

const Batch = z.object({ items: z.array(z.object({ jd: z.string(), company_url: z.string(), days: z.any() })).min(1, 'The file has no entries.').max(10, 'Upload at most 10 roles at a time.') });

kitsRouter.post('/batch', async (req, res) => {
  const { items } = parseBody(Batch, req.body);
  const results = [];
  for (const [i, raw] of items.entries()) {
    const parsed = NewKit.safeParse(raw);
    if (!parsed.success) {
      results.push({ index: i, ok: false, error: { code: 'VALIDATION_FAILED', message: parsed.error.issues[0].message } });
      continue;
    }
    const { doc, duplicate } = await createKit(req.user.id, parsed.data);
    results.push({ index: i, ok: true, kit: summary(doc), duplicate });
  }
  res.status(202).json({ results });
});

kitsRouter.get('/:id', async (req, res) => {
  res.json(view(await getOwnedKit(req.params.id, req.user.id)));
});

kitsRouter.get('/:id/status', async (req, res) => {
  const d = await getOwnedKit(req.params.id, req.user.id);
  res.json({
    status: d.status,
    progress: d.progress,
    error: d.error,
    queue_position: generationQueue.position(String(d._id)),
    regenerating: d.regenerating,
    last_regeneration: d.lastRegeneration,
    rev: d.rev,
  });
});

kitsRouter.post('/:id/retry', async (req, res) => {
  const { doc } = await mutate(req.params.id, req.user.id, (d) => {
    if (d.status !== 'failed') throw new AppError('NOT_FAILED', 'Only failed kits can be retried.', { status: 409 });
    return { status: 'queued', error: null, progress: [], activeKey: d.dedupeKey };
  });
  enqueueGeneration(doc._id);
  res.status(202).json({ kit: summary(doc) });
});

kitsRouter.delete('/:id', async (req, res) => {
  const d = await getOwnedKit(req.params.id, req.user.id);
  if (d.status === 'running') throw new AppError('KIT_RUNNING', 'Wait for generation to finish before deleting this kit.', { status: 409 });
  await Kit.deleteOne({ _id: d._id, userId: req.user.id });
  res.json({ ok: true });
});

// ---------- builder ----------

const BriefPatch = z.object({
  summary: z.string().max(5000).optional(),
  what_they_do: z.string().max(5000).optional(),
  hiring_process: z.string().max(5000).optional(),
  talking_points: z.array(z.string().max(500)).max(20).optional(),
  unknowns: z.array(z.string().max(500)).max(20).optional(),
  pinned: z.boolean().optional(),
});
kitsRouter.patch('/:id/brief', (req, res) => edit(req, res, (k) => M.updateBrief(k, parseBody(BriefPatch, req.body))));

const QuestionFields = {
  prompt: z.string().trim().min(1, 'A question needs some text.').max(2000).optional(),
  answer_outline: z.string().max(5000).optional(),
  difficulty: z.coerce.number().int().min(1).max(3).optional(),
  category: z.enum(CATEGORIES).optional(),
  requirement_ids: z.array(z.string()).max(30).optional(),
};
kitsRouter.post('/:id/questions', (req, res) =>
  edit(req, res, (k) => M.addQuestion(k, parseBody(z.object({ ...QuestionFields, after: z.string().optional() }), req.body)), 201)
);
kitsRouter.put('/:id/questions/order', (req, res) => edit(req, res, (k) => M.reorderQuestions(k, parseBody(z.object({ order: z.array(z.string()) }), req.body).order)));
kitsRouter.patch('/:id/questions/:qid', (req, res) =>
  edit(req, res, (k) => M.updateQuestion(k, req.params.qid, parseBody(z.object({ ...QuestionFields, pinned: z.boolean().optional() }), req.body)))
);
kitsRouter.post('/:id/questions/:qid/move', (req, res) =>
  edit(req, res, (k) => M.moveQuestion(k, req.params.qid, parseBody(z.object({ category: z.enum(CATEGORIES), index: z.number().int().min(0).optional() }), req.body)))
);
kitsRouter.delete('/:id/questions/:qid', (req, res) => edit(req, res, (k) => M.deleteQuestion(k, req.params.qid)));

const CardFields = { front: z.string().trim().min(1).max(1000).optional(), back: z.string().max(3000).optional(), requirement_ids: z.array(z.string()).max(30).optional() };
kitsRouter.post('/:id/flashcards', (req, res) => edit(req, res, (k) => M.addFlashcard(k, parseBody(z.object(CardFields), req.body)), 201));
kitsRouter.put('/:id/flashcards/order', (req, res) => edit(req, res, (k) => M.reorderFlashcards(k, parseBody(z.object({ order: z.array(z.string()) }), req.body).order)));
kitsRouter.patch('/:id/flashcards/:fid', (req, res) =>
  edit(req, res, (k) => M.updateFlashcard(k, req.params.fid, parseBody(z.object({ ...CardFields, pinned: z.boolean().optional() }), req.body)))
);
kitsRouter.delete('/:id/flashcards/:fid', (req, res) =>
  edit(req, res, (k, d) => {
    const kit = M.deleteFlashcard(k, req.params.fid);
    const cards = { ...(d.practice?.cards || {}) };
    delete cards[req.params.fid];
    return { kit, set: { practice: { ...(d.practice || {}), cards } } };
  })
);

kitsRouter.patch('/:id/schedule', (req, res) => edit(req, res, (k) => M.setSchedulePinned(k, parseBody(z.object({ pinned: z.boolean() }), req.body).pinned)));
kitsRouter.patch('/:id/schedule/days/:day', (req, res) =>
  edit(req, res, (k) =>
    M.updateScheduleDay(
      k,
      req.params.day,
      parseBody(z.object({ focus: z.string().max(300).optional(), minutes: z.coerce.number().int().min(0).max(1440).optional(), question_ids: z.array(z.string()).optional() }), req.body)
    )
  )
);

// ---------- regeneration ----------

const Regen = z.object({ section: z.enum(['company_brief', 'questions', 'schedule', 'gaps']), category: z.enum(CATEGORIES).optional() });

kitsRouter.post('/:id/regenerate', async (req, res) => {
  const body = parseBody(Regen, req.body);
  if (body.section === 'questions' && !body.category) throw new AppError('VALIDATION_FAILED', 'Choose which question category to regenerate.');
  const { doc } = await mutate(req.params.id, req.user.id, (d) => {
    if (d.status !== 'ready') throw new AppError('KIT_NOT_READY', 'This kit is still being generated.', { status: 409 });
    if (d.regenerating) throw new AppError('ALREADY_REGENERATING', 'A section is already being regenerated. Wait for it to finish.', { status: 409 });
    if (body.section === 'company_brief' && d.kit.company_brief?.meta?.pinned) throw new AppError('SECTION_PINNED', 'The brief is pinned. Unpin it to regenerate.', { status: 409 });
    if (body.section === 'schedule' && d.kit.schedule?.meta?.pinned) throw new AppError('SECTION_PINNED', 'The schedule is pinned. Unpin it to regenerate.', { status: 409 });
    return { regenerating: { ...body, started_at: new Date().toISOString() } };
  });
  enqueueRegeneration(doc._id, body);
  res.status(202).json({ regenerating: doc.regenerating });
});

// ---------- practice ----------

kitsRouter.get('/:id/practice', async (req, res) => {
  const d = await getOwnedKit(req.params.id, req.user.id);
  if (!d.kit) throw new AppError('KIT_NOT_READY', 'This kit is still being generated.', { status: 409 });
  res.json({ order: sessionOrder(d.kit, d.practice), summary: practiceSummary(d.kit, d.practice), state: d.practice });
});

kitsRouter.post('/:id/practice/reviews', async (req, res) => {
  const { card_id, confidence } = parseBody(z.object({ card_id: z.string(), confidence: z.number().int().min(1).max(3) }), req.body);
  const { doc } = await mutate(req.params.id, req.user.id, (d) => {
    if (!d.kit?.flashcards.some((f) => f.id === card_id)) throw new AppError('NOT_FOUND', 'Flashcard not found.', { status: 404 });
    return { practice: recordReview(d.practice, card_id, confidence) };
  });
  res.json({ summary: practiceSummary(doc.kit, doc.practice), state: doc.practice });
});

kitsRouter.post('/:id/practice/sessions', async (req, res) => {
  const { doc } = await mutate(req.params.id, req.user.id, (d) => ({ practice: { ...(d.practice || { cards: {} }), sessions: (d.practice?.sessions || 0) + 1 } }));
  res.json({ order: sessionOrder(doc.kit, doc.practice), summary: practiceSummary(doc.kit, doc.practice) });
});

kitsRouter.delete('/:id/practice', async (req, res) => {
  const { doc } = await mutate(req.params.id, req.user.id, () => ({ practice: { cards: {}, sessions: 0 } }));
  res.json({ order: sessionOrder(doc.kit, doc.practice), summary: practiceSummary(doc.kit, doc.practice), state: doc.practice });
});

// ---------- story bank ----------

const StoryBody = z.object({
  title: z.string().trim().min(1, 'Give the story a short title.').max(200),
  situation: z.string().max(2000).default(''),
  action: z.string().max(2000).default(''),
  result: z.string().max(2000).default(''),
  requirement_ids: z.array(z.string()).max(30).default([]),
});

function storiesResponse(doc) {
  return { stories: doc.stories, coverage: storyCoverage(doc.kit, doc.stories) };
}

kitsRouter.get('/:id/stories', async (req, res) => {
  const d = await getOwnedKit(req.params.id, req.user.id);
  if (!d.kit) throw new AppError('KIT_NOT_READY', 'This kit is still being generated.', { status: 409 });
  res.json(storiesResponse(d));
});

kitsRouter.post('/:id/stories', async (req, res) => {
  const body = parseBody(StoryBody, req.body);
  const { doc } = await mutate(req.params.id, req.user.id, (d) => {
    const known = new Set(d.kit.role.requirements.map((r) => r.id));
    const story = { ...body, id: `s${d.nextStory || 1}`, requirement_ids: body.requirement_ids.filter((id) => known.has(id)) };
    return { stories: [...(d.stories || []), story], nextStory: (d.nextStory || 1) + 1 };
  });
  res.status(201).json(storiesResponse(doc));
});

kitsRouter.patch('/:id/stories/:sid', async (req, res) => {
  const body = parseBody(StoryBody.partial(), req.body);
  const { doc } = await mutate(req.params.id, req.user.id, (d) => {
    const known = new Set(d.kit.role.requirements.map((r) => r.id));
    const stories = (d.stories || []).map((s) =>
      s.id === req.params.sid ? { ...s, ...body, requirement_ids: (body.requirement_ids ?? s.requirement_ids).filter((id) => known.has(id)) } : s
    );
    if (!stories.some((s) => s.id === req.params.sid)) throw new AppError('NOT_FOUND', 'Story not found.', { status: 404 });
    return { stories };
  });
  res.json(storiesResponse(doc));
});

kitsRouter.delete('/:id/stories/:sid', async (req, res) => {
  const { doc } = await mutate(req.params.id, req.user.id, (d) => ({ stories: (d.stories || []).filter((s) => s.id !== req.params.sid) }));
  res.json(storiesResponse(doc));
});
