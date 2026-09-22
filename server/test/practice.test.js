import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recordReview, sessionOrder, practiceSummary, storyCoverage } from '../src/kit/practice.js';

const kit = {
  role: { requirements: [{ id: 'r1', text: 'A', kind: 'technical', priority: 'must' }, { id: 'r2', text: 'B', kind: 'behavioural', priority: 'nice' }] },
  flashcards: [
    { id: 'f1', front: '1', back: '', requirement_ids: ['r2'] },
    { id: 'f2', front: '2', back: '', requirement_ids: ['r1'] },
    { id: 'f3', front: '3', back: '', requirement_ids: ['r1'] },
  ],
  questions: [{ id: 'q1', category: 'behavioural', requirement_ids: ['r2'] }],
};

test('unseen cards first (must-haves before nice), then least confident', () => {
  let p = recordReview(undefined, 'f3', 1);
  assert.deepEqual(sessionOrder(kit, p), ['f2', 'f1', 'f3']);
  p = recordReview(p, 'f2', 3);
  p = recordReview(p, 'f1', 2);
  assert.deepEqual(sessionOrder(kit, p), ['f3', 'f1', 'f2']);
});

test('twice-confident cards sink to the end', () => {
  let p = recordReview(undefined, 'f2', 3);
  p = recordReview(p, 'f2', 3);
  assert.equal(sessionOrder(kit, p).at(-1), 'f2');
});

test('rejects invalid confidence', () => assert.throws(() => recordReview(undefined, 'f1', 5)));

test('summary reports covered vs not covered per requirement', () => {
  const p = recordReview(recordReview(undefined, 'f2', 3), 'f3', 3);
  const s = practiceSummary(kit, p);
  assert.equal(s.reviewed, 2);
  assert.equal(s.requirements.find((r) => r.requirement_id === 'r1').status, 'ready');
  assert.equal(s.requirements.find((r) => r.requirement_id === 'r2').status, 'not_covered');
});

test('story coverage lists behavioural requirements without a story first', () => {
  const cov = storyCoverage(kit, []);
  assert.deepEqual(cov.map((c) => c.requirement_id), ['r2']);
  assert.deepEqual(storyCoverage(kit, [{ id: 's1', requirement_ids: ['r2'] }])[0].story_ids, ['s1']);
});
