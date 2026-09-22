import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../src/kit/mutations.js';
import { computeCategoryRegeneration, applyCategoryRegeneration, applyBriefRegeneration, regenerateSchedule } from '../src/kit/regenerate.js';
import { validateKit } from '../src/kit/schema.js';
import { runPipeline } from '../src/pipeline/runPipeline.js';
import { mockLLM, TEST_CONFIG } from './helpers.js';

const JD = `Senior Backend Engineer
Requirements:
- 5+ years with Node.js
- Strong PostgreSQL skills
- Experience designing distributed systems
- Experience mentoring junior engineers
Nice to have:
- Kafka experience`;

const offlineFetcher = { get: async () => { throw Object.assign(new Error('offline'), { code: 'NETWORK' }); } };

async function makeKit() {
  const { kit } = await runPipeline({ jd: JD, company_url: 'https://acme.example', days: 5 }, { llm: mockLLM(), fetcher: offlineFetcher, config: TEST_CONFIG });
  return kit;
}

test('editing a question marks it edited and keeps the kit valid', async () => {
  const kit = await makeKit();
  const q = kit.questions[0];
  const k2 = M.updateQuestion(kit, q.id, { prompt: 'My better wording' });
  const edited = k2.questions.find((x) => x.id === q.id);
  assert.equal(edited.prompt, 'My better wording');
  assert.equal(edited.meta.edited, true);
  assert.equal(kit.questions[0].prompt, q.prompt, 'original kit untouched (pure function)');
  assert.equal(validateKit(k2).ok, true);
});

test('category regeneration keeps user-written, edited and pinned questions and replaces the rest', async () => {
  const kit = await makeKit();
  const tech = kit.questions.filter((q) => q.category === 'technical');
  assert.ok(tech.length >= 3);
  let k = M.updateQuestion(kit, tech[0].id, { prompt: 'Edited by me' });
  k = M.updateQuestion(k, tech[1].id, { pinned: true });
  const added = M.addQuestion(k, { category: 'technical', prompt: 'Written by me', requirement_ids: ['r1'] });
  k = added.kit;
  const untouched = tech.slice(2).map((q) => q.id);

  const computed = await computeCategoryRegeneration(k, 'technical', { llm: mockLLM({ perfect: true }) });
  const { kit: after, summary } = applyCategoryRegeneration(k, computed);
  const ids = after.questions.map((q) => q.id);
  assert.ok(ids.includes(tech[0].id) && ids.includes(tech[1].id) && ids.includes(added.item.id));
  assert.equal(after.questions.find((q) => q.id === tech[0].id).prompt, 'Edited by me');
  for (const id of untouched) assert.ok(!ids.includes(id), `${id} should have been replaced`);
  assert.equal(summary.kept, 3);
  // Other categories are untouched.
  assert.deepEqual(after.questions.filter((q) => q.category === 'behavioural'), k.questions.filter((q) => q.category === 'behavioural'));
  assert.equal(validateKit(after).ok, true);
});

test('an edit made WHILE a category regenerates survives the merge', async () => {
  const kit = await makeKit();
  const target = kit.questions.find((q) => q.category === 'technical');
  const computed = await computeCategoryRegeneration(kit, 'technical', { llm: mockLLM() }); // slow phase on the snapshot
  const latest = M.updateQuestion(kit, target.id, { answer_outline: 'typed during regeneration' }); // user edit lands meanwhile
  const { kit: merged } = applyCategoryRegeneration(latest, computed); // merge re-reads protection from the latest kit
  assert.equal(merged.questions.find((q) => q.id === target.id)?.answer_outline, 'typed during regeneration');
});

test('ids are never reused after deletion', async () => {
  const kit = await makeKit();
  const last = kit.questions.at(-1).id;
  const k = M.deleteQuestion(kit, last);
  const { item } = M.addQuestion(k, { category: 'technical', prompt: 'new' });
  assert.notEqual(item.id, last);
});

test('deleting the only question for a requirement surfaces a coverage gap and repairs the schedule', async () => {
  const kit = await makeKit();
  const r = kit.role.requirements[0];
  let k = kit;
  for (const q of kit.questions.filter((x) => x.requirement_ids.includes(r.id))) k = M.deleteQuestion(k, q.id);
  assert.ok(k.coverage.uncovered_requirement_ids.includes(r.id));
  const ids = new Set(k.questions.map((q) => q.id));
  assert.ok(k.schedule.days.every((d) => d.question_ids.every((id) => ids.has(id))));
  assert.equal(k.schedule.days.length, 5);
});

test('reorder requires an exact permutation; move changes category and position', async () => {
  const kit = await makeKit();
  const ids = kit.questions.map((q) => q.id);
  const reversed = M.reorderQuestions(kit, [...ids].reverse());
  assert.deepEqual(reversed.questions.map((q) => q.id), [...ids].reverse());
  assert.throws(() => M.reorderQuestions(kit, ids.slice(1)), /changed/);
  const q = kit.questions.find((x) => x.category === 'technical');
  const moved = M.moveQuestion(kit, q.id, { category: 'behavioural', index: 0 });
  const beh = moved.questions.filter((x) => x.category === 'behavioural');
  assert.equal(beh[0].id, q.id);
});

test('a user-edited schedule is kept (not rebuilt) when questions change', async () => {
  const kit = await makeKit();
  let k = M.updateScheduleDay(kit, 1, { focus: 'My own plan' });
  const { kit: k2, item } = M.addQuestion(k, { category: 'technical', prompt: 'extra', requirement_ids: ['r1'] });
  assert.equal(k2.schedule.days[0].focus, 'My own plan');
  assert.ok(k2.schedule.days.some((d) => d.question_ids.includes(item.id)), 'new question placed into the edited schedule');
});

test('pinned brief and schedule refuse regeneration', async () => {
  const kit = await makeKit();
  const pinnedBrief = M.updateBrief(kit, { pinned: true });
  assert.throws(() => applyBriefRegeneration(pinnedBrief, { summary: 'x', what_they_do: 'y', sources: [] }), /pinned/);
  const pinnedSchedule = M.setSchedulePinned(kit, true);
  assert.throws(() => regenerateSchedule(pinnedSchedule), /pinned/);
});
