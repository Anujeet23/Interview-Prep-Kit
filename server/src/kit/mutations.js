import { AppError } from '../lib/errors.js';
import { findGaps } from '../pipeline/coverage.js';
import { buildSchedule } from '../pipeline/scheduler.js';
import { CATEGORIES } from '../pipeline/categoryPlanner.js';

/**
 * Builder operations. Every function takes a kit, returns a NEW kit (structuredClone),
 * and never touches the database, so the rules are unit-testable.
 *
 * State model, per item (question, flashcard, brief, schedule):
 *   meta.origin  'generated' | 'template' | 'user'   who wrote it
 *   meta.edited  true once a person changes its content
 *   meta.pinned  true when the person says "keep this as is"
 *
 * The rule regeneration follows: an item is PROTECTED if origin === 'user' OR edited OR pinned.
 * Regenerating a question category replaces only unprotected questions in that category.
 * Regenerating the brief or schedule is refused while it is pinned.
 */
export const isProtected = (item) => Boolean(item?.meta && (item.meta.origin === 'user' || item.meta.edited || item.meta.pinned));

const clone = (k) => structuredClone(k);
const nowIso = () => new Date().toISOString();

function nextId(kit, kind) {
  kit.builder_state ??= {};
  const key = kind === 'q' ? 'next_question' : 'next_flashcard';
  const list = kind === 'q' ? kit.questions : kit.flashcards;
  const maxExisting = list.reduce((m, it) => Math.max(m, Number(String(it.id).slice(1)) || 0), 0);
  const n = Math.max(kit.builder_state[key] ?? 1, maxExisting + 1);
  kit.builder_state[key] = n + 1;
  return `${kind}${n}`;
}

function cleanReqIds(kit, ids) {
  const known = new Set(kit.role.requirements.map((r) => r.id));
  return [...new Set((ids || []).map(String))].filter((id) => known.has(id));
}

function checkCategory(c) {
  if (!CATEGORIES.includes(c)) throw new AppError('INVALID_CATEGORY', `Category must be one of ${CATEGORIES.join(', ')}.`);
}

function findOr404(list, id, what) {
  const i = list.findIndex((x) => x.id === id);
  if (i < 0) throw new AppError('NOT_FOUND', `${what} ${id} not found.`, { status: 404 });
  return i;
}

/** Recompute coverage and keep the schedule consistent after the question set changes. */
export function afterQuestionsChanged(kit) {
  const gaps = findGaps(kit.role.requirements, kit.questions);
  kit.coverage = { ...kit.coverage, uncovered_requirement_ids: gaps.map((g) => g.id) };
  if (isProtected(kit.schedule)) {
    // The user shaped the schedule: keep their days, drop deleted ids, and place new
    // questions on the lightest early day rather than rebuilding everything.
    const ids = new Set(kit.questions.map((q) => q.id));
    for (const d of kit.schedule.days) d.question_ids = d.question_ids.filter((id) => ids.has(id));
    const scheduled = new Set(kit.schedule.days.flatMap((d) => d.question_ids));
    const firstHalf = kit.schedule.days.slice(0, Math.max(1, Math.ceil(kit.schedule.days.length / 2)));
    for (const q of kit.questions) {
      if (scheduled.has(q.id)) continue;
      const day = firstHalf.reduce((a, b) => (b.minutes < a.minutes ? b : a));
      day.question_ids.push(q.id);
      day.minutes += q.difficulty === 3 ? 25 : q.difficulty === 1 ? 10 : 15;
    }
  } else {
    const meta = kit.schedule.meta;
    kit.schedule = buildSchedule({ questions: kit.questions, requirements: kit.role.requirements, days: kit.schedule.days_available });
    kit.schedule.meta = meta ?? { origin: 'generated', edited: false, pinned: false };
  }
  return kit;
}

const QUESTION_CONTENT = ['prompt', 'answer_outline', 'difficulty', 'category', 'requirement_ids'];

export function updateQuestion(kit, id, patch) {
  const k = clone(kit);
  const q = k.questions[findOr404(k.questions, id, 'Question')];
  let contentChanged = false;
  let structural = false;
  for (const f of QUESTION_CONTENT) {
    if (patch[f] === undefined) continue;
    let v = patch[f];
    if (f === 'category') checkCategory(v);
    if (f === 'difficulty') v = Math.min(3, Math.max(1, Math.round(Number(v) || 2)));
    if (f === 'requirement_ids') v = cleanReqIds(k, v);
    if (JSON.stringify(q[f]) !== JSON.stringify(v)) {
      q[f] = v;
      contentChanged = true;
      if (['difficulty', 'category', 'requirement_ids'].includes(f)) structural = true;
    }
  }
  q.meta ??= { origin: 'generated', edited: false, pinned: false };
  if (contentChanged) {
    q.meta.edited = true;
    q.meta.updated_at = nowIso();
  }
  if (typeof patch.pinned === 'boolean') q.meta.pinned = patch.pinned;
  return structural ? afterQuestionsChanged(k) : k;
}

export function addQuestion(kit, data) {
  const k = clone(kit);
  const category = data.category || 'technical';
  checkCategory(category);
  const q = {
    id: nextId(k, 'q'),
    requirement_ids: cleanReqIds(k, data.requirement_ids),
    category,
    prompt: String(data.prompt || '').trim() || 'New question',
    answer_outline: String(data.answer_outline || '').trim(),
    difficulty: Math.min(3, Math.max(1, Math.round(Number(data.difficulty) || 2))),
    meta: { origin: 'user', edited: false, pinned: false, updated_at: nowIso() },
  };
  if (data.after) {
    const i = k.questions.findIndex((x) => x.id === data.after);
    k.questions.splice(i < 0 ? k.questions.length : i + 1, 0, q);
  } else k.questions.push(q);
  return { kit: afterQuestionsChanged(k), item: q };
}

export function deleteQuestion(kit, id) {
  const k = clone(kit);
  k.questions.splice(findOr404(k.questions, id, 'Question'), 1);
  return afterQuestionsChanged(k);
}

/** `order` must be a permutation of the current question ids. */
export function reorderQuestions(kit, order) {
  const k = clone(kit);
  const ids = k.questions.map((q) => q.id);
  if (order.length !== ids.length || new Set(order).size !== ids.length || !order.every((id) => ids.includes(id))) {
    throw new AppError('STALE_ORDER', 'The question list changed since you loaded it. Refresh and try again.', { status: 409 });
  }
  const byId = new Map(k.questions.map((q) => [q.id, q]));
  k.questions = order.map((id) => byId.get(id));
  return k;
}

/** Move a question to another category and place it at `index` within that category. */
export function moveQuestion(kit, id, { category, index }) {
  let k = updateQuestion(kit, id, { category });
  const q = k.questions.find((x) => x.id === id);
  const rest = k.questions.filter((x) => x.id !== id);
  const inCat = rest.filter((x) => x.category === q.category);
  const anchor = inCat[Math.max(0, Math.min(index ?? inCat.length, inCat.length))];
  const pos = anchor ? rest.indexOf(anchor) : rest.length;
  rest.splice(pos, 0, q);
  k.questions = rest;
  return k;
}

export function updateFlashcard(kit, id, patch) {
  const k = clone(kit);
  const f = k.flashcards[findOr404(k.flashcards, id, 'Flashcard')];
  let changed = false;
  for (const field of ['front', 'back', 'requirement_ids']) {
    if (patch[field] === undefined) continue;
    const v = field === 'requirement_ids' ? cleanReqIds(k, patch[field]) : String(patch[field]);
    if (JSON.stringify(f[field]) !== JSON.stringify(v)) {
      f[field] = v;
      changed = true;
    }
  }
  f.meta ??= { origin: 'generated', edited: false, pinned: false };
  if (changed) {
    f.meta.edited = true;
    f.meta.updated_at = nowIso();
  }
  if (typeof patch.pinned === 'boolean') f.meta.pinned = patch.pinned;
  return k;
}

export function addFlashcard(kit, data) {
  const k = clone(kit);
  const f = {
    id: nextId(k, 'f'),
    front: String(data.front || '').trim() || 'New card',
    back: String(data.back || '').trim(),
    requirement_ids: cleanReqIds(k, data.requirement_ids),
    meta: { origin: 'user', edited: false, pinned: false, updated_at: nowIso() },
  };
  k.flashcards.push(f);
  return { kit: k, item: f };
}

export function deleteFlashcard(kit, id) {
  const k = clone(kit);
  k.flashcards.splice(findOr404(k.flashcards, id, 'Flashcard'), 1);
  return k;
}

export function reorderFlashcards(kit, order) {
  const k = clone(kit);
  const ids = k.flashcards.map((f) => f.id);
  if (order.length !== ids.length || !order.every((id) => ids.includes(id)) || new Set(order).size !== ids.length) {
    throw new AppError('STALE_ORDER', 'The flashcard list changed since you loaded it. Refresh and try again.', { status: 409 });
  }
  const byId = new Map(k.flashcards.map((f) => [f.id, f]));
  k.flashcards = order.map((id) => byId.get(id));
  return k;
}

export function updateBrief(kit, patch) {
  const k = clone(kit);
  const b = k.company_brief;
  let changed = false;
  for (const field of ['summary', 'what_they_do', 'hiring_process']) {
    if (patch[field] !== undefined && b[field] !== String(patch[field])) {
      b[field] = String(patch[field]);
      changed = true;
    }
  }
  for (const field of ['talking_points', 'unknowns']) {
    if (Array.isArray(patch[field])) {
      b[field] = patch[field].map(String).filter((s) => s.trim());
      changed = true;
    }
  }
  b.meta ??= { origin: 'generated', edited: false, pinned: false };
  if (changed) {
    b.meta.edited = true;
    b.meta.updated_at = nowIso();
  }
  if (typeof patch.pinned === 'boolean') b.meta.pinned = patch.pinned;
  return k;
}

export function updateScheduleDay(kit, dayNumber, patch) {
  const k = clone(kit);
  const d = k.schedule.days.find((x) => x.day === Number(dayNumber));
  if (!d) throw new AppError('NOT_FOUND', `Day ${dayNumber} not found.`, { status: 404 });
  if (patch.focus !== undefined) d.focus = String(patch.focus);
  if (patch.minutes !== undefined) {
    const m = Math.round(Number(patch.minutes));
    if (!Number.isInteger(m) || m < 0 || m > 1440) throw new AppError('INVALID_MINUTES', 'Minutes must be a whole number between 0 and 1440.');
    d.minutes = m;
  }
  if (Array.isArray(patch.question_ids)) {
    const ids = new Set(k.questions.map((q) => q.id));
    d.question_ids = [...new Set(patch.question_ids)].filter((id) => ids.has(id));
  }
  k.schedule.meta = { ...(k.schedule.meta || { origin: 'generated', pinned: false }), edited: true, updated_at: nowIso() };
  return k;
}

export function setSchedulePinned(kit, pinned) {
  const k = clone(kit);
  k.schedule.meta = { ...(k.schedule.meta || { origin: 'generated', edited: false }), pinned: Boolean(pinned) };
  return k;
}
