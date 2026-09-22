import { AppError } from '../lib/errors.js';

/**
 * Practice ordering: confidence-weighted, not spaced repetition.
 *
 * Spaced-repetition intervals (1d, 3d, 7d, ...) are built for months of study; most people
 * using this have days. So the next session is simply:
 *   1. unseen cards first (confidence 0: we know nothing about them),
 *   2. then lowest last confidence (1 "again" < 2 "shaky" < 3 "confident"),
 *   3. ties: cards backing a must-have requirement first, then least recently reviewed.
 * Cards rated 3 twice in a row drop to the end, so a session doesn't waste time on them.
 */
export const CONFIDENCE = { 1: 'again', 2: 'shaky', 3: 'confident' };

export function emptyPractice() {
  return { cards: {}, sessions: 0 };
}

export function recordReview(practice, cardId, confidence, now = new Date()) {
  const c = Number(confidence);
  if (![1, 2, 3].includes(c)) throw new AppError('INVALID_CONFIDENCE', 'Confidence must be 1, 2 or 3.');
  const p = structuredClone(practice || emptyPractice());
  const prev = p.cards[cardId] || { reviews: 0, history: [] };
  p.cards[cardId] = {
    confidence: c,
    reviews: prev.reviews + 1,
    last_reviewed_at: now.toISOString(),
    history: [...(prev.history || []), c].slice(-10),
  };
  return p;
}

export function sessionOrder(kit, practice, { limit } = {}) {
  const must = new Set(kit.role.requirements.filter((r) => r.priority === 'must').map((r) => r.id));
  const state = practice?.cards || {};
  const scored = kit.flashcards.map((f, idx) => {
    const s = state[f.id];
    const conf = s?.confidence ?? 0;
    const mastered = s && s.history?.length >= 2 && s.history.slice(-2).every((h) => h === 3);
    return {
      id: f.id,
      conf: mastered ? 4 : conf,
      must: f.requirement_ids.some((id) => must.has(id)) ? 0 : 1,
      last: s?.last_reviewed_at ? Date.parse(s.last_reviewed_at) : 0,
      idx,
    };
  });
  scored.sort((a, b) => a.conf - b.conf || a.must - b.must || a.last - b.last || a.idx - b.idx);
  const ids = scored.map((s) => s.id);
  return limit ? ids.slice(0, limit) : ids;
}

/** Per-requirement readiness from flashcard confidence. */
export function practiceSummary(kit, practice) {
  const state = practice?.cards || {};
  const seen = kit.flashcards.filter((f) => state[f.id]);
  const byReq = kit.role.requirements.map((r) => {
    const cards = kit.flashcards.filter((f) => f.requirement_ids.includes(r.id));
    const rated = cards.filter((f) => state[f.id]);
    const avg = rated.length ? rated.reduce((s, f) => s + state[f.id].confidence, 0) / rated.length : null;
    return {
      requirement_id: r.id,
      text: r.text,
      priority: r.priority,
      cards: cards.length,
      reviewed: rated.length,
      average_confidence: avg === null ? null : Math.round(avg * 10) / 10,
      status: !cards.length ? 'no_cards' : rated.length < cards.length ? 'not_covered' : avg >= 2.5 ? 'ready' : 'needs_work',
    };
  });
  return {
    total: kit.flashcards.length,
    reviewed: seen.length,
    confident: seen.filter((f) => state[f.id].confidence === 3).length,
    shaky: seen.filter((f) => state[f.id].confidence === 2).length,
    again: seen.filter((f) => state[f.id].confidence === 1).length,
    requirements: byReq,
  };
}

/**
 * Story bank (creative feature): behavioural rounds are answered with the candidate's own
 * stories, and one good story can serve several requirements. This is the coverage check
 * again, pointed at the candidate instead of the kit: which requirements have no story yet?
 */
export function storyCoverage(kit, stories = []) {
  const reqs = kit.role.requirements;
  const byReq = new Map(reqs.map((r) => [r.id, []]));
  for (const s of stories) for (const id of s.requirement_ids || []) byReq.get(id)?.push(s.id);
  const behaviouralQuestions = kit.questions.filter((q) => q.category === 'behavioural' || q.category === 'company-fit');
  const needsStory = new Set(behaviouralQuestions.flatMap((q) => q.requirement_ids));
  for (const r of reqs) if (r.kind === 'behavioural') needsStory.add(r.id);
  return reqs
    .filter((r) => needsStory.has(r.id))
    .map((r) => ({ requirement_id: r.id, text: r.text, priority: r.priority, story_ids: byReq.get(r.id) }))
    .sort((a, b) => Math.min(a.story_ids.length, 1) - Math.min(b.story_ids.length, 1) || (a.priority === 'must' ? 0 : 1) - (b.priority === 'must' ? 0 : 1));
}
