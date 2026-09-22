import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSchedule, checkSchedule, questionPriority, partitionFrontLoaded } from '../src/pipeline/scheduler.js';
import { reqs, questionsFor } from './helpers.js';

const requirements = reqs([['must'], ['must'], ['must', 'behavioural'], ['nice'], ['nice', 'domain']]);
const questions = questionsFor(requirements, 2);

for (const days of [1, 2, 3, 5, 7, 14, 30, 60, 365]) {
  test(`schedule spans exactly ${days} day(s) and satisfies every rule`, () => {
    const s = buildSchedule({ questions, requirements, days });
    assert.equal(s.days_available, days);
    assert.equal(s.days.length, days);
    assert.deepEqual(checkSchedule(s, { questions, requirements, days }), []);
    for (const d of s.days) {
      assert.ok(Number.isInteger(d.minutes), 'minutes must be an integer');
      assert.ok(d.question_ids.length > 0, `day ${d.day} is empty`);
      assert.ok(d.focus.length > 0);
    }
  });
}

test('every question is scheduled at least once (nothing dropped)', () => {
  for (const days of [1, 3, 5, 60]) {
    const s = buildSchedule({ questions, requirements, days });
    const scheduled = new Set(s.days.flatMap((d) => d.question_ids));
    for (const q of questions) assert.ok(scheduled.has(q.id), `${q.id} missing for ${days} days`);
  }
});

test('harder and must-have material lands earlier than the last learning day', () => {
  const reqById = new Map(requirements.map((r) => [r.id, r]));
  const s = buildSchedule({ questions, requirements, days: 5 });
  const learning = s.days.filter((d) => d.focus.startsWith('Learn'));
  const avg = (d) => d.question_ids.reduce((sum, id) => sum + questionPriority(questions.find((q) => q.id === id), reqById), 0) / d.question_ids.length;
  assert.ok(avg(learning[0]) >= avg(learning[learning.length - 1]));
  assert.ok(learning[0].minutes >= learning[learning.length - 1].minutes, 'day 1 should carry at least as much as the last learning day');
});

test('1-day schedule contains every question', () => {
  const s = buildSchedule({ questions, requirements, days: 1 });
  assert.equal(s.days[0].question_ids.length, questions.length);
});

test('final day of a longer schedule is a light review, not new material', () => {
  const s = buildSchedule({ questions, requirements, days: 7 });
  const last = s.days.at(-1);
  assert.match(last.focus, /^Final review/);
  assert.ok(last.minutes < s.days[0].minutes);
});

test('rejects non-integer and out-of-range day counts', () => {
  for (const bad of [0, -1, 2.5, 366, 'abc', null]) assert.throws(() => buildSchedule({ questions, requirements, days: bad }));
});

test('empty question list still yields the requested number of days', () => {
  const s = buildSchedule({ questions: [], requirements: [], days: 4 });
  assert.equal(s.days.length, 4);
});

test('partitionFrontLoaded preserves order and gives each day at least one item', () => {
  const items = Array.from({ length: 9 }, (_, i) => ({ m: 10, i }));
  const parts = partitionFrontLoaded(items, 4);
  assert.equal(parts.length, 4);
  assert.ok(parts.every((p) => p.length >= 1));
  assert.deepEqual(parts.flat().map((x) => x.i), items.map((x) => x.i));
  assert.ok(parts[0].length >= parts[3].length);
});
