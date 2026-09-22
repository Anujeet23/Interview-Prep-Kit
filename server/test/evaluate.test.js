import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { startFixtureServer } from '../scripts/serve-fixtures.js';
import { validateKit } from '../src/kit/schema.js';

const run = promisify(execFile);
let server;
let port;
before(async () => {
  server = await startFixtureServer(0);
  port = server.address().port;
});
after(() => server.close());

test('npm run evaluate: Appendix B output, one entry per case, failures recorded not fatal', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ipk-'));
  const input = path.join(dir, 'cases.json');
  const output = path.join(dir, 'kits.json');
  const cases = JSON.parse(await fs.readFile(new URL('../fixtures/cases.sample.json', import.meta.url), 'utf8')).map((c) => ({
    ...c,
    company_url: c.company_url.replace('localhost:8099', `localhost:${port}`),
  }));
  cases.push({ id: 'case-bad', jd: '', company_url: 'x', days: 0 });
  await fs.writeFile(input, JSON.stringify(cases));

  await run(process.execPath, ['server/scripts/evaluate.js', '--input', input, '--output', output, '--mock'], {
    cwd: path.resolve(new URL('../..', import.meta.url).pathname),
    env: { ...process.env, DISCUSSION_SEARCH: 'false', LOG_LEVEL: 'silent' },
    timeout: 120_000,
  });

  const out = JSON.parse(await fs.readFile(output, 'utf8'));
  assert.equal(out.version, '1.0');
  assert.ok(!Number.isNaN(Date.parse(out.generated_at)));
  assert.equal(out.kits.length, cases.length);
  for (const c of cases) {
    const entry = out.kits.find((k) => k.id === c.id);
    if (c.id === 'case-bad') {
      assert.equal(entry.status, 'failed');
      assert.equal(entry.kit, null);
      assert.equal(entry.error.code, 'INVALID_INPUT');
      continue;
    }
    assert.equal(entry.status, 'ok', `${c.id}: ${JSON.stringify(entry.error)}`);
    assert.equal(entry.error, null);
    assert.deepEqual(validateKit(entry.kit).errors, []);
    assert.equal(entry.kit.schedule.days.length, c.days);
    assert.deepEqual(entry.kit.coverage.uncovered_requirement_ids, []);
  }
  const acme = out.kits.find((k) => k.id === 'case-01').kit;
  assert.equal(acme.research.hiring_page_found, true);
  assert.ok(acme.questions.some((q) => q.category === 'system-design'), 'published system design round -> system design questions');
  assert.ok(acme.coverage.passes >= 2, 'mock model leaves a gap, so the second pass must run');
  const unreachable = out.kits.find((k) => k.id === 'case-04').kit;
  assert.equal(unreachable.research.company_reachable, false);
  assert.match(unreachable.company_brief.summary, /could not read/);
});
