import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateKit } from '../src/kit/schema.js';
import { buildSchedule } from '../src/pipeline/scheduler.js';
import { reqs, questionsFor } from './helpers.js';

function goodKit() {
  const requirements = reqs([['must'], ['nice', 'behavioural']]);
  const questions = questionsFor(requirements);
  return {
    source: { company: 'Acme', company_url: 'https://acme.test', role: 'Engineer', location: '', jd_chars: 100, researched_at: new Date().toISOString(), pages_used: [] },
    company_brief: { summary: 's', what_they_do: 'w', sources: [] },
    role: { title: 'Engineer', seniority: 'mid', responsibilities: [], requirements },
    questions,
    flashcards: [{ id: 'f1', front: 'a', back: 'b', requirement_ids: ['r1'] }],
    schedule: buildSchedule({ questions, requirements, days: 3 }),
    coverage: { uncovered_requirement_ids: [], passes: 1 },
  };
}

test('a well-formed kit passes strict validation', () => {
  assert.deepEqual(validateKit(goodKit()), { ok: true, errors: [] });
});

test('extensions are allowed', () => {
  const k = goodKit();
  k.research = { anything: true };
  k.questions[0].meta = { origin: 'generated', edited: false, pinned: false };
  assert.equal(validateKit(k).ok, true);
});

const cases = [
  ['missing top-level field', (k) => delete k.coverage, /coverage/],
  ['float minutes', (k) => (k.schedule.days[0].minutes = 12.5), /minutes|integer/i],
  ['difficulty out of range', (k) => (k.questions[0].difficulty = 5), /difficulty/],
  ['bad priority', (k) => (k.role.requirements[0].priority = 'required'), /priority/],
  ['unknown requirement reference', (k) => (k.questions[0].requirement_ids = ['r99']), /unknown requirement r99/],
  ['schedule references missing question', (k) => k.schedule.days[0].question_ids.push('q404'), /missing question q404/],
  ['wrong number of days', (k) => k.schedule.days.pop(), /expected 3/],
  ['duplicate question id', (k) => (k.questions[1].id = 'q1'), /duplicate question id/],
  ['uncovered must-have', (k) => (k.questions = k.questions.filter((q) => !q.requirement_ids.includes('r1'))), /r1/],
  ['wrong field name', (k) => { k.company_brief.what_they_Do = k.company_brief.what_they_do; delete k.company_brief.what_they_do; }, /what_they_do/],
];
for (const [name, breakIt, re] of cases) {
  test(`rejects: ${name}`, () => {
    const k = goodKit();
    breakIt(k);
    const r = validateKit(k);
    assert.equal(r.ok, false);
    assert.match(r.errors.join(' | '), re);
  });
}

test('non-strict mode allows a user-made coverage gap but still checks references', () => {
  const k = goodKit();
  k.questions = k.questions.filter((q) => !q.requirement_ids.includes('r1'));
  k.schedule.days.forEach((d) => (d.question_ids = d.question_ids.filter((id) => k.questions.some((q) => q.id === id))));
  assert.equal(validateKit(k, { strict: false }).ok, true);
  k.questions[0].requirement_ids = ['r42'];
  assert.equal(validateKit(k, { strict: false }).ok, false);
});
