import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.LLM_PROVIDERS = 'mock';
process.env.DISCUSSION_SEARCH = 'false';
process.env.ALLOW_PRIVATE_URLS = 'true';
process.env.LOG_LEVEL = 'silent';

const { installFakeModels } = await import('./support/fakeModels.js');
installFakeModels();
const { createApp } = await import('../src/app.js');
const { startFixtureServer } = await import('../scripts/serve-fixtures.js');

let api;
let fixtures;
let base;
let site;

before(async () => {
  fixtures = await startFixtureServer(0);
  site = `http://localhost:${fixtures.address().port}`;
  api = createApp().listen(0);
  base = `http://localhost:${api.address().port}/api`;
});
after(() => {
  api.close();
  fixtures.close();
});

function client() {
  let cookie = '';
  return async (path, { method = 'GET', body } = {}) => {
    const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json', cookie }, body: body && JSON.stringify(body) });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return { status: res.status, body: await res.json().catch(() => null) };
  };
}

async function waitReady(c, id) {
  for (let i = 0; i < 200; i++) {
    const s = await c(`/kits/${id}/status`);
    if (s.body.status === 'ready' || s.body.status === 'failed') return s.body;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('timeout');
}

async function waitRegen(c, id) {
  for (let i = 0; i < 200; i++) {
    const s = await c(`/kits/${id}/status`);
    if (!s.body.regenerating) return s.body;
    await new Promise((r) => setTimeout(r, 30));
  }
  throw new Error('timeout');
}

const JD = `Senior Backend Engineer
Requirements:
- 5+ years with Node.js
- Strong PostgreSQL skills
- Experience mentoring junior engineers
Nice to have:
- Kafka experience`;

test('signed-out visitors cannot reach kit endpoints', async () => {
  const c = client();
  const r = await c('/kits');
  assert.equal(r.status, 401);
  assert.equal(r.body.error.code, 'UNAUTHENTICATED');
});

test('invalid/expired session cookie is rejected with a clear code', async () => {
  const res = await fetch(`${base}/kits`, { headers: { cookie: 'ipk_session=garbage' } });
  assert.equal(res.status, 401);
  assert.equal((await res.json()).error.code, 'INVALID_SESSION');
});

test('register validates input and rejects duplicates', async () => {
  const c = client();
  assert.equal((await c('/auth/register', { method: 'POST', body: { email: 'bad', password: 'x' } })).status, 400);
  assert.equal((await c('/auth/register', { method: 'POST', body: { email: 'dup@test.io', password: 'password1' } })).status, 201);
  assert.equal((await c('/auth/register', { method: 'POST', body: { email: 'dup@test.io', password: 'password1' } })).status, 409);
  assert.equal((await client()('/auth/login', { method: 'POST', body: { email: 'dup@test.io', password: 'wrong-pass' } })).status, 401);
});

test('full flow: create -> generate -> edit -> regenerate keeps edits -> practice; other users are locked out', async () => {
  const alice = client();
  await alice('/auth/register', { method: 'POST', body: { email: 'alice@test.io', password: 'password1' } });

  const created = await alice('/kits', { method: 'POST', body: { jd: JD, company_url: `${site}/acme/`, days: 4 } });
  assert.equal(created.status, 202);
  const id = created.body.kit.id;

  // Same posting again while running -> same kit, not a second job.
  const again = await alice('/kits', { method: 'POST', body: { jd: JD, company_url: `${site}/acme/`, days: 4 } });
  assert.equal(again.body.kit.id, id);
  assert.ok(['in_progress', 'exists'].includes(again.body.duplicate));

  const status = await waitReady(alice, id);
  assert.equal(status.status, 'ready', JSON.stringify(status.error));
  assert.ok(status.progress.some((p) => p.key === 'coverage'));

  let kit = (await alice(`/kits/${id}`)).body.kit;
  assert.equal(kit.schedule.days.length, 4);

  // Submitting the finished posting again offers the existing kit.
  assert.equal((await alice('/kits', { method: 'POST', body: { jd: JD, company_url: `${site}/acme/`, days: 4 } })).body.duplicate, 'exists');

  // Another user sees 404 for alice's kit (no existence leak).
  const bob = client();
  await bob('/auth/register', { method: 'POST', body: { email: 'bob@test.io', password: 'password1' } });
  assert.equal((await bob(`/kits/${id}`)).status, 404);
  assert.equal((await bob(`/kits/${id}/questions/${kit.questions[0].id}`, { method: 'PATCH', body: { prompt: 'hijack' } })).status, 404);
  assert.equal((await bob('/kits')).body.kits.length, 0);

  // Edit one technical question, then regenerate the technical category.
  const tech = kit.questions.filter((q) => q.category === 'technical');
  const edited = await alice(`/kits/${id}/questions/${tech[0].id}`, { method: 'PATCH', body: { prompt: 'My own wording' } });
  assert.equal(edited.status, 200);
  const regen = await alice(`/kits/${id}/regenerate`, { method: 'POST', body: { section: 'questions', category: 'technical' } });
  assert.equal(regen.status, 202);
  const done = await waitRegen(alice, id);
  assert.equal(done.last_regeneration.ok, true, JSON.stringify(done.last_regeneration));
  kit = (await alice(`/kits/${id}`)).body.kit;
  assert.equal(kit.questions.find((q) => q.id === tech[0].id)?.prompt, 'My own wording');
  assert.ok(!kit.questions.some((q) => q.id === tech[1].id), 'unedited generated question was replaced');

  // Reorder with a stale list is refused.
  assert.equal((await alice(`/kits/${id}/questions/order`, { method: 'PUT', body: { order: ['q1'] } })).status, 409);
  const reversed = kit.questions.map((q) => q.id).reverse();
  assert.deepEqual((await alice(`/kits/${id}/questions/order`, { method: 'PUT', body: { order: reversed } })).body.kit.questions.map((q) => q.id), reversed);

  // Pinned brief can't be regenerated.
  await alice(`/kits/${id}/brief`, { method: 'PATCH', body: { pinned: true } });
  assert.equal((await alice(`/kits/${id}/regenerate`, { method: 'POST', body: { section: 'company_brief' } })).status, 409);

  // Practice.
  const p = await alice(`/kits/${id}/practice`);
  const first = p.body.order[0];
  const rated = await alice(`/kits/${id}/practice/reviews`, { method: 'POST', body: { card_id: first, confidence: 1 } });
  assert.equal(rated.body.summary.reviewed, 1);
  assert.equal((await alice(`/kits/${id}/practice/reviews`, { method: 'POST', body: { card_id: first, confidence: 9 } })).status, 400);

  // Story bank.
  const beh = kit.role.requirements.find((r) => r.kind === 'behavioural');
  const st = await alice(`/kits/${id}/stories`, { method: 'POST', body: { title: 'Mentored a new hire', requirement_ids: [beh.id] } });
  assert.equal(st.status, 201);
  assert.deepEqual(st.body.coverage.find((c) => c.requirement_id === beh.id).story_ids, ['s1']);
});

test('request validation returns structured errors', async () => {
  const c = client();
  await c('/auth/register', { method: 'POST', body: { email: 'val@test.io', password: 'password1' } });
  const r = await c('/kits', { method: 'POST', body: { jd: 'short', company_url: '', days: 0 } });
  assert.equal(r.status, 400);
  assert.equal(r.body.error.code, 'VALIDATION_FAILED');
  assert.ok(r.body.error.details.length >= 2);
});

test('cross-site POST with a foreign Origin is refused', async () => {
  const res = await fetch(`${base}/auth/logout`, { method: 'POST', headers: { origin: 'https://evil.example' } });
  assert.equal(res.status, 403);
});
