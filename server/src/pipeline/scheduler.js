import { truncate } from '../lib/text.js';

export const MIN_DAYS = 1;
export const MAX_DAYS = 365;

const BASE_MINUTES = { 1: 10, 2: 15, 3: 25 };
const CATEGORY_EXTRA = { 'system-design': 20, technical: 0, behavioural: 0, 'company-fit': -5 };

/** Integer minutes to prepare one question properly. */
export function questionMinutes(q) {
  return Math.max(5, (BASE_MINUTES[q.difficulty] ?? 15) + (CATEGORY_EXTRA[q.category] ?? 0));
}

/**
 * Priority score: must-have coverage dominates, then difficulty.
 * (must: 20, nice-only: 10, no requirement: 5) + difficulty * 3
 */
export function questionPriority(q, reqById) {
  const reqs = (q.requirement_ids || []).map((id) => reqById.get(id)).filter(Boolean);
  const base = reqs.some((r) => r.priority === 'must') ? 20 : reqs.length ? 10 : 5;
  return base + (q.difficulty || 2) * 3 + (q.category === 'system-design' ? 1 : 0);
}

export function validateDays(days) {
  const n = Number(days);
  if (!Number.isInteger(n) || n < MIN_DAYS || n > MAX_DAYS) {
    throw Object.assign(new Error(`days must be a whole number from ${MIN_DAYS} to ${MAX_DAYS}`), { code: 'INVALID_DAYS' });
  }
  return n;
}

/**
 * Allocates questions across exactly `days` days.
 *
 * 1. Sort questions by priority (must-haves and harder material first).
 * 2. Split the window into a learning phase and a review phase. With 4+ days, ~25% of the
 *    days (at least one) are review. Learning days are capped at ceil(Q/2) so each learning
 *    day has real content; any extra days become spaced review.
 * 3. Learning days are filled in priority order against front-loaded minute targets:
 *    day i gets weight (2L - i), so day 1 carries about twice the load of the last learning day.
 *    Every learning day gets at least one question and every question is scheduled once.
 * 4. Review days cycle through the questions in priority order (about a third per day, 2-6, 40% of the
 *    original minutes). The final day is a light must-have review, never new material.
 */
export function buildSchedule({ questions, requirements, days }) {
  const N = validateDays(days);
  const reqById = new Map(requirements.map((r) => [r.id, r]));
  const sorted = questions
    .map((q, idx) => ({ q, idx, p: questionPriority(q, reqById), m: questionMinutes(q) }))
    .sort((a, b) => b.p - a.p || a.idx - b.idx);
  const Q = sorted.length;

  if (!Q) {
    return {
      days_available: N,
      days: Array.from({ length: N }, (_, i) => ({ day: i + 1, focus: 'No questions yet: add some in the question bank', question_ids: [], minutes: 0 })),
    };
  }

  let reviewDays = N >= 4 ? Math.max(1, Math.round(N * 0.25)) : 0;
  let learnDays = Math.min(N - reviewDays, Q, Math.max(1, Math.ceil(Q / 2)));
  if (N <= 3) learnDays = Math.min(N, Q);
  reviewDays = N - learnDays;

  const learning = partitionFrontLoaded(sorted, learnDays);
  const out = learning.map((items, i) => ({
    day: i + 1,
    focus: focusFor(items, reqById, 'Learn'),
    question_ids: items.map((it) => it.q.id),
    minutes: items.reduce((s, it) => s + it.m, 0),
  }));

  for (let r = 0; r < reviewDays; r++) {
    const isFinal = r === reviewDays - 1;
    let items;
    if (isFinal) {
      const must = sorted.filter((it) => it.p >= 20);
      items = (must.length ? must : sorted).slice(0, 5);
    } else {
      const per = Math.min(Q, 6, Math.max(2, Math.ceil(Q / 3)));
      const start = (r * per) % Q;
      items = Array.from({ length: per }, (_, k) => sorted[(start + k) % Q]);
      items = [...new Map(items.map((it) => [it.q.id, it])).values()];
    }
    out.push({
      day: learnDays + r + 1,
      focus: isFinal ? `Final review: ${truncate(summariseTopics(items, reqById), 80)}` : focusFor(items, reqById, 'Review'),
      question_ids: items.map((it) => it.q.id),
      minutes: Math.max(10, Math.round(items.reduce((s, it) => s + it.m, 0) * (isFinal ? 0.3 : 0.4))),
    });
  }

  return { days_available: N, days: out };
}

/** Contiguous, order-preserving split with decreasing per-day minute targets. */
export function partitionFrontLoaded(items, L) {
  if (L <= 1) return [items.slice()];
  const total = items.reduce((s, it) => s + it.m, 0);
  const weights = Array.from({ length: L }, (_, i) => 2 * L - i);
  const wSum = weights.reduce((a, b) => a + b, 0);
  const targets = weights.map((w) => (total * w) / wSum);
  const days = [];
  let k = 0;
  for (let d = 0; d < L; d++) {
    const remainingDays = L - d - 1;
    const bucket = [];
    let mins = 0;
    if (d === L - 1) {
      bucket.push(...items.slice(k));
      k = items.length;
    } else {
      while (k < items.length - remainingDays) {
        const next = items[k];
        // Take at least one; then stop once adding the next would overshoot the target by more than half its size.
        if (bucket.length && mins + next.m / 2 > targets[d]) break;
        bucket.push(next);
        mins += next.m;
        k++;
      }
    }
    days.push(bucket);
  }
  return days;
}

function summariseTopics(items, reqById) {
  const counts = new Map();
  for (const it of items) {
    for (const id of it.q.requirement_ids || []) {
      const r = reqById.get(id);
      if (r) counts.set(r.text, (counts.get(r.text) || 0) + (r.priority === 'must' ? 2 : 1));
    }
  }
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([t]) => truncate(t, 38));
  if (top.length) return top.join(' + ');
  const cats = [...new Set(items.map((it) => it.q.category))];
  return cats.join(' + ');
}

function focusFor(items, reqById, verb) {
  const cats = [...new Set(items.map((it) => it.q.category))];
  const catLabel = cats.length === 1 ? cats[0] : `${cats.length} categories`;
  return `${verb}: ${truncate(summariseTopics(items, reqById), 80)} (${catLabel})`;
}

/**
 * Checks the rules from the brief. Used by tests and by the kit validator.
 */
export function checkSchedule(schedule, { questions, requirements, days }) {
  const errors = [];
  const qIds = new Set(questions.map((q) => q.id));
  if (schedule.days_available !== days) errors.push(`days_available ${schedule.days_available} != ${days}`);
  if (schedule.days.length !== days) errors.push(`schedule has ${schedule.days.length} days, expected ${days}`);
  schedule.days.forEach((d, i) => {
    if (d.day !== i + 1) errors.push(`day ${i + 1} is numbered ${d.day}`);
    if (!Number.isInteger(d.minutes) || d.minutes < 0) errors.push(`day ${d.day} minutes is not a non-negative integer`);
    for (const id of d.question_ids) if (!qIds.has(id)) errors.push(`day ${d.day} references missing question ${id}`);
  });
  const scheduled = new Set(schedule.days.flatMap((d) => d.question_ids));
  const scheduledReqs = new Set(questions.filter((q) => scheduled.has(q.id)).flatMap((q) => q.requirement_ids));
  for (const r of requirements) if (r.priority === 'must' && !scheduledReqs.has(r.id)) errors.push(`must-have ${r.id} is not in the schedule`);
  return errors;
}
