import { test } from 'node:test';
import assert from 'node:assert/strict';
import { priorityFromPosting, locateEvidence } from '../src/pipeline/grounding.js';
import { groundRequirements, extractRequirements, inferSeniority } from '../src/pipeline/extractRequirements.js';
import { mockLLM } from './helpers.js';
import { createLLM } from '../src/llm/client.js';

const JD = `Senior Backend Engineer

Requirements:
- 5+ years with Node.js
- Strong PostgreSQL skills
- Experience mentoring junior engineers

Nice to have:
- Kafka experience
- Go

Also: experience with Terraform is a plus.`;

const line = (text) => locateEvidence(JD, text).line;

test('priority comes from the section heading', () => {
  assert.equal(priorityFromPosting(JD, line('5+ years with Node.js')), 'must');
  assert.equal(priorityFromPosting(JD, line('Kafka experience')), 'nice');
  assert.equal(priorityFromPosting(JD, line('Go')), 'nice');
});

test('priority comes from inline wording', () => {
  assert.equal(priorityFromPosting(JD, line('experience with Terraform is a plus')), 'nice');
});

test('invented requirements are dropped, posting priority overrides the model', () => {
  const { requirements, dropped } = groundRequirements(JD, [
    { text: 'Node.js (5+ years)', kind: 'technical', priority: 'must', evidence: '5+ years with Node.js' },
    { text: 'Kafka', kind: 'technical', priority: 'must', evidence: 'Kafka experience' },
    { text: 'Kubernetes', kind: 'technical', priority: 'must', evidence: 'Kubernetes in production' },
    { text: 'Mentoring', kind: 'behavioural', priority: 'must', evidence: 'mentoring junior engineers' },
  ]);
  assert.deepEqual(requirements.map((r) => r.text), ['Node.js (5+ years)', 'Mentoring', 'Kafka']);
  assert.equal(requirements.find((r) => r.text === 'Kafka').priority, 'nice');
  assert.deepEqual(requirements.map((r) => r.id), ['r1', 'r2', 'r3']);
  assert.equal(dropped[0].text, 'Kubernetes');
});

test('near-duplicate requirements are merged', () => {
  const { requirements } = groundRequirements(JD, [
    { text: 'Strong PostgreSQL skills', kind: 'technical', priority: 'must', evidence: 'Strong PostgreSQL skills' },
    { text: 'PostgreSQL skills (strong)', kind: 'technical', priority: 'must', evidence: 'Strong PostgreSQL skills' },
  ]);
  assert.equal(requirements.length, 1);
});

test('a two-line stub produces a thin kit that says so', async () => {
  const out = await extractRequirements('Data Engineer\nPython and SQL.', { llm: mockLLM() });
  assert.equal(out.thin, true);
  assert.deepEqual(out.role.requirements.map((r) => r.text), ['Python', 'SQL']);
  assert.match(out.notes.join(' '), /short/);
});

test('with no model available, extraction falls back to rules and says so', async () => {
  const noModel = createLLM({ slots: [] });
  const out = await extractRequirements(JD, { llm: noModel });
  assert.equal(out.method, 'heuristic');
  assert.ok(out.role.requirements.length >= 5);
  assert.match(out.notes[0], /rule-based/);
});

test('seniority is inferred from the title before anything else', () => {
  assert.equal(inferSeniority('Senior Backend Engineer', ''), 'senior');
  assert.equal(inferSeniority('Backend Engineer', '8+ years of experience'), 'staff');
  assert.equal(inferSeniority('Backend Engineer', ''), 'unspecified');
});
