import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findGaps, closeCoverageGaps } from '../src/pipeline/coverage.js';
import { reqs, mockLLM } from './helpers.js';

const role = { title: 'Engineer', seniority: 'senior' };
const requirements = reqs([['must'], ['must'], ['must', 'behavioural'], ['nice']]);

test('findGaps is purely id-based', () => {
  const qs = [{ requirement_ids: ['r1'] }, { requirement_ids: ['r2', 'r4'] }];
  assert.deepEqual(findGaps(requirements, qs).map((r) => r.id), ['r3']);
  assert.equal(findGaps(requirements, []).length, 4);
});

test('second pass closes gaps the first draft left and records the passes', async () => {
  const draft = [{ requirement_ids: ['r1'], category: 'technical', prompt: 'Explain r1 deeply', answer_outline: '', difficulty: 2 }];
  const out = await closeCoverageGaps({ llm: mockLLM(), requirements, questions: draft, role, brief: null, signals: {} });
  assert.deepEqual(out.uncovered, []);
  assert.equal(out.passes, 2);
  assert.deepEqual(out.log[0].gaps, ['r2', 'r3', 'r4']);
  assert.deepEqual(out.log[1].gaps, []);
  assert.deepEqual(out.templated, []);
});

test('when the model keeps failing, labelled template questions guarantee coverage', async () => {
  const llm = mockLLM({ failTasks: ['gap_questions'] });
  const out = await closeCoverageGaps({ llm, requirements, questions: [], role, brief: null, signals: {} });
  assert.deepEqual(out.uncovered, []);
  assert.deepEqual(out.templated.sort(), ['r1', 'r2', 'r3', 'r4']);
  assert.ok(out.questions.every((q) => q.template));
  assert.equal(out.passes, 4); // draft check + 2 model passes + template pass
});

test('no gaps means a single pass and no model calls', async () => {
  const llm = mockLLM();
  const qs = requirements.map((r) => ({ requirement_ids: [r.id], category: 'technical', prompt: `q ${r.id}`, answer_outline: '', difficulty: 1 }));
  const out = await closeCoverageGaps({ llm, requirements, questions: qs, role, brief: null, signals: {} });
  assert.equal(out.passes, 1);
  assert.equal(llm.stats.calls, 0);
});
