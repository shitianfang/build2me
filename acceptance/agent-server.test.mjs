// The coordination server, end to end: publish a contract, submit against it,
// read the frontier, the graph and the search index over an HTTP API.
//
// The gate starts tools/serve.mjs itself on an ephemeral port (--port 0) against
// a THROWAWAY copy of the demo fixture, so it never touches the fixture, never
// binds a fixed port, and never leaves a process behind (t.after kills it).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const demo = path.join(repoRoot, 'acceptance', 'fixtures', 'demo');
const serve = path.join(repoRoot, 'tools', 'serve.mjs');

// Starts the server on an ephemeral port and registers its shutdown before the
// first await, so even a half-started process is reaped.
async function startServer(t, dir) {
  const child = spawn(process.execPath, [serve, '--dir', dir, '--port', '0'], { stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await once(child, 'exit').catch(() => {});
  });
  let out = '';
  let err = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (c) => { err += c; });
  return await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`tools/serve.mjs printed no listening line in 20s\n${out}\n${err}`)), 20000);
    child.stdout.on('data', (c) => {
      out += c;
      const m = out.match(/listening on (http:\/\/\S+)/);
      if (m) {
        clearTimeout(timer);
        resolve(m[1].replace(/\/$/, ''));
      }
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`tools/serve.mjs exited (code ${code}) before listening\n${out}\n${err}`));
    });
  });
}

async function call(base, route, init) {
  const res = await fetch(`${base}${route}`, init);
  const text = await res.text();
  assert.match(
    res.headers.get('content-type') ?? '',
    /application\/json/,
    `${route} must answer JSON, got ${res.status}: ${text.slice(0, 300)}`,
  );
  return { status: res.status, headers: res.headers, body: JSON.parse(text) };
}

const get = (base, route) => call(base, route);
const send = (base, method, route, payload) =>
  call(base, route, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });

const tool = (name, dir, ...extra) =>
  spawnSync(process.execPath, [path.join(repoRoot, 'tools', name), '--dir', dir, ...extra], { encoding: 'utf8', timeout: 120000 });

// Every error body must name the real cause and the concrete remedy.
function assertLegibleError(body, route) {
  assert.equal(typeof body.error, 'string', `${route}: error body needs an "error" string, got ${JSON.stringify(body)}`);
  assert.ok(body.error.trim().length > 0, `${route}: empty error message`);
  assert.equal(typeof body.remedy, 'string', `${route}: error body needs a "remedy" string, got ${JSON.stringify(body)}`);
  assert.ok(body.remedy.trim().length > 0, `${route}: empty remedy`);
}

const DIV = {
  name: 'div',
  title: 'Integer division',
  interface: 'div(a: number, b: number): number — truncating division over positive integers.',
  acceptance: 'node --test test/div.test.mjs',
  nl_description: 'Leaf contract published over the HTTP API by the agent-server acceptance gate.',
  serves: 'calc',
  env: 'node>=20',
};

test('the coordination server serves one project directory over HTTP', async (t) => {
  assert.ok(fs.existsSync(serve), `missing artifact: ${serve} (the contract's implementation)`);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'b2m-serve-'));
  fs.cpSync(demo, dir, { recursive: true });
  const base = await startServer(t, dir);

  await t.test('GET /api/contracts lists every contract with derived status', async () => {
    const r = await get(base, '/api/contracts');
    assert.equal(r.status, 200);
    assert.equal(r.body.dir, dir);
    assert.deepEqual(r.body.contracts.map((c) => [c.name, c.status]), [['add', 'done'], ['calc', 'open'], ['mul', 'open']]);
    const add = r.body.contracts[0];
    for (const f of ['title', 'interface', 'acceptance', 'nl_description', 'env']) {
      assert.equal(typeof add[f], 'string', `contract row is missing "${f}"`);
    }
    assert.equal(add.serves, 'calc');
  });

  await t.test('GET /api/contracts/<name> carries the contract\'s submissions and verdicts', async () => {
    const r = await get(base, '/api/contracts/calc');
    assert.equal(r.status, 200);
    assert.equal(r.body.name, 'calc');
    assert.equal(r.body.status, 'open');
    assert.deepEqual(
      r.body.submissions.map((s) => [s.id, s.kind, s.verdict]),
      [['dec-001', 'decomposition', 'SKETCH_ACCEPTED']],
    );
    assert.deepEqual(r.body.submissions[0].imports, ['add', 'mul']);

    const miss = await get(base, '/api/contracts/nope');
    assert.equal(miss.status, 404);
    assertLegibleError(miss.body, 'GET /api/contracts/nope');
    assert.match(miss.body.error, /nope/);
  });

  await t.test('POST /api/contracts publishes a contract file', async () => {
    const r = await send(base, 'POST', '/api/contracts', DIV);
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.name, 'div');
    const file = path.join(dir, 'contracts', 'div.json');
    assert.ok(fs.existsSync(file), 'POST /api/contracts must write contracts/<name>.json');
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), DIV);

    const back = await get(base, '/api/contracts/div');
    assert.equal(back.status, 200);
    assert.equal(back.body.status, 'open');
    assert.deepEqual(back.body.submissions, []);
  });

  await t.test('POST /api/contracts refuses to overwrite: contracts are immutable', async () => {
    const before = fs.readFileSync(path.join(dir, 'contracts', 'add.json'), 'utf8');
    const r = await send(base, 'POST', '/api/contracts', { ...DIV, name: 'add', title: 'Hijacked' });
    assert.equal(r.status, 409, JSON.stringify(r.body));
    assertLegibleError(r.body, 'POST /api/contracts (existing name)');
    assert.match(r.body.error, /add/);
    assert.match(r.body.remedy, /deprecat/i, 'the remedy must name deprecate-and-supersede');
    assert.match(r.body.remedy, /supersed/i, 'the remedy must name deprecate-and-supersede');
    assert.equal(fs.readFileSync(path.join(dir, 'contracts', 'add.json'), 'utf8'), before, 'the existing contract was modified');
  });

  await t.test('POST /api/contracts enforces the contract schema', async () => {
    const missing = await send(base, 'POST', '/api/contracts', { name: 'halfbaked', title: 'Half baked' });
    assert.equal(missing.status, 400, JSON.stringify(missing.body));
    assertLegibleError(missing.body, 'POST /api/contracts (missing fields)');
    assert.match(missing.body.error, /interface/);
    assert.ok(!fs.existsSync(path.join(dir, 'contracts', 'halfbaked.json')), 'a rejected contract must not be written');

    const traversal = await send(base, 'POST', '/api/contracts', { ...DIV, name: '../escape' });
    assert.equal(traversal.status, 400, JSON.stringify(traversal.body));
    assertLegibleError(traversal.body, 'POST /api/contracts (bad name)');
    assert.ok(!fs.existsSync(path.join(dir, '..', 'escape.json')), 'a contract name must never escape contracts/');

    const bad = await call(base, '/api/contracts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{not json' });
    assert.equal(bad.status, 400);
    assertLegibleError(bad.body, 'POST /api/contracts (bad JSON)');
  });

  await t.test('POST /api/submissions answers with the verdict of a fresh pass', async () => {
    fs.writeFileSync(path.join(dir, 'src', 'mul.mjs'), 'export function mul(a, b) {\n  return a * b;\n}\n');
    const payload = {
      contract: 'mul',
      kind: 'implementation',
      imports: [],
      files: ['src/mul.mjs'],
      notes: 'Plain multiplication; submitted over the HTTP API.',
    };
    const r = await send(base, 'POST', '/api/submissions', payload);
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.id, 'sub-001', 'an omitted id must auto-generate sub-NNN');
    assert.equal(r.body.contract, 'mul');
    assert.equal(r.body.verdict, 'ACCEPTED');
    assert.equal(r.body.status, 'done');

    const meta = JSON.parse(fs.readFileSync(path.join(dir, 'impl', 'mul', 'sub-001', 'meta.json'), 'utf8'));
    assert.deepEqual(meta, payload);

    // Cascade: mul Done closes the sketched parent through its own gate.
    const calc = await get(base, '/api/contracts/calc');
    assert.equal(calc.body.status, 'done');
    assert.equal(calc.body.submissions[0].verdict, 'ACCEPTED');
  });

  await t.test('POST /api/submissions never overwrites an existing submission', async () => {
    const before = fs.readFileSync(path.join(dir, 'impl', 'mul', 'sub-001', 'meta.json'), 'utf8');
    const r = await send(base, 'POST', '/api/submissions', {
      contract: 'mul', id: 'sub-001', kind: 'implementation', imports: [], files: ['src/mul.mjs'], notes: 'squatting on a taken id',
    });
    assert.equal(r.status, 409, JSON.stringify(r.body));
    assertLegibleError(r.body, 'POST /api/submissions (taken id)');
    assert.match(r.body.error, /sub-001/);
    assert.equal(fs.readFileSync(path.join(dir, 'impl', 'mul', 'sub-001', 'meta.json'), 'utf8'), before);
  });

  await t.test('a failed attempt is recorded, not discarded', async () => {
    fs.writeFileSync(path.join(dir, 'src', 'div.mjs'), 'export function div(a, b) {\n  return a / b;\n}\n');
    fs.writeFileSync(
      path.join(dir, 'test', 'div.test.mjs'),
      [
        "import test from 'node:test';",
        "import assert from 'node:assert/strict';",
        "import { div } from '../src/div.mjs';",
        '',
        "test('truncates', () => {",
        '  assert.equal(div(7, 2), 3);',
        '});',
        '',
      ].join('\n'),
    );
    const r = await send(base, 'POST', '/api/submissions', {
      contract: 'div',
      kind: 'implementation',
      imports: [],
      files: ['src/div.mjs'],
      notes: 'Dead end: plain / does not truncate, div(7,2) came back 3.5.',
    });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.verdict, 'GATE_FAILED');
    assert.equal(r.body.status, 'open');
    assert.ok(fs.existsSync(path.join(dir, 'impl', 'div', 'sub-001', 'meta.json')), 'a failed attempt stays on disk');
  });

  await t.test('POST /api/submissions enforces the protocol\'s structural rules', async () => {
    const base404 = await send(base, 'POST', '/api/submissions', { contract: 'ghost', kind: 'implementation', imports: [], files: [] });
    assert.equal(base404.status, 404, JSON.stringify(base404.body));
    assertLegibleError(base404.body, 'POST /api/submissions (unknown contract)');
    assert.match(base404.body.error, /ghost/);

    const cases = [
      [{ contract: 'div', kind: 'implementation', imports: ['div'], files: ['src/div.mjs'] }, /self-import/i],
      [{ contract: 'div', kind: 'implementation', imports: ['ghost'], files: ['src/div.mjs'] }, /ghost/],
      [{ contract: 'div', kind: 'implementation', imports: [], files: ['src/ghost.mjs'] }, /src\/ghost\.mjs/],
      [{ contract: 'div', kind: 'guesswork', imports: [], files: ['src/div.mjs'] }, /implementation/],
    ];
    for (const [payload, cause] of cases) {
      const r = await send(base, 'POST', '/api/submissions', payload);
      assert.equal(r.status, 400, `expected 400 for ${JSON.stringify(payload)}, got ${r.status} ${JSON.stringify(r.body)}`);
      assertLegibleError(r.body, 'POST /api/submissions (invalid)');
      assert.match(r.body.error, cause);
    }
    assert.ok(!fs.existsSync(path.join(dir, 'impl', 'div', 'sub-002')), 'a rejected submission must not be written');
  });

  await t.test('GET /api/frontier reports the same numbers as tools/frontier.mjs', async () => {
    const r = await get(base, '/api/frontier');
    assert.equal(r.status, 200);
    const cli = tool('frontier.mjs', dir, '--json');
    assert.equal(cli.status, 0, cli.stdout + cli.stderr);
    assert.deepEqual(r.body, JSON.parse(cli.stdout));
    // div is actionable: its own gate is what stands in the way.
    assert.ok(r.body.open.some((x) => x.name === 'div'), `div missing from the frontier: ${JSON.stringify(r.body.open)}`);
  });

  await t.test('GET /api/graph is the same DAG as tools/graph.mjs --format json', async () => {
    const r = await get(base, '/api/graph');
    assert.equal(r.status, 200);
    const cli = tool('graph.mjs', dir, '--format', 'json');
    assert.equal(cli.status, 0, cli.stdout + cli.stderr);
    assert.deepEqual(r.body, JSON.parse(cli.stdout));
    assert.ok(r.body.nodes.some((n) => n.name === 'calc' && n.status === 'done'));
    assert.ok(r.body.edges.some((e) => e.from === 'calc' && e.to === 'mul'));
  });

  await t.test('GET /api/search returns contract AND submission hits, failures included', async () => {
    const contracts = await get(base, '/api/search?q=MULTIPLIC');
    assert.equal(contracts.status, 200);
    assert.ok(Array.isArray(contracts.body.contracts) && Array.isArray(contracts.body.submissions), 'both hit kinds are always present');
    assert.deepEqual(contracts.body.contracts.map((c) => c.name), ['mul'], 'search must be case-insensitive over title');

    const prose = await get(base, '/api/search?q=published%20over%20the%20HTTP%20API');
    assert.deepEqual(prose.body.contracts.map((c) => c.name), ['div'], 'search must cover nl_description');

    const failed = await get(base, '/api/search?q=dead%20end');
    assert.equal(failed.body.contracts.length, 0);
    assert.deepEqual(
      failed.body.submissions.map((s) => [s.contract, s.id, s.verdict]),
      [['div', 'sub-001', 'GATE_FAILED']],
      'failed submissions are assets and must be findable by their notes',
    );

    const empty = await get(base, '/api/search');
    assert.equal(empty.status, 400);
    assertLegibleError(empty.body, 'GET /api/search (no q)');
    assert.match(empty.body.error, /q/);
  });

  await t.test('unknown routes and methods fail legibly, in JSON', async () => {
    const miss = await get(base, '/nope');
    assert.equal(miss.status, 404);
    assertLegibleError(miss.body, 'GET /nope');

    const wrong = await call(base, '/api/contracts/add', { method: 'DELETE' });
    assert.ok([404, 405].includes(wrong.status), `DELETE on a contract must be refused, got ${wrong.status}`);
    assertLegibleError(wrong.body, 'DELETE /api/contracts/add');
    assert.ok(fs.existsSync(path.join(dir, 'contracts', 'add.json')), 'contracts are never deleted');
  });
});
