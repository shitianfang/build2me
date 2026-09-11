import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const init = (...args) => spawnSync('node', [path.join(repoRoot, 'tools', 'init.mjs'), ...args], { encoding: 'utf8', timeout: 60000 });
const inProject = (dir, tool, ...args) =>
  spawnSync('node', [path.join(dir, 'tools', tool), '--dir', dir, ...args], { encoding: 'utf8', timeout: 120000 });
const fresh = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'b2m-init-')), 'proj');

test('scaffolds a project that verifies green with its root Open', () => {
  const dir = fresh();
  const r = init(dir, '--root', 'my-system');
  assert.equal(r.status, 0, r.stdout + r.stderr);

  for (const rel of ['contracts/my-system.json', 'acceptance/my-system.test.mjs', 'laws/laws.md',
    'laws/deprecations.log', 'tools/verify.mjs', 'tools/frontier.mjs', 'tools/lib.mjs', 'impl']) {
    assert.ok(fs.existsSync(path.join(dir, rel)), `missing scaffolded path: ${rel}`);
  }

  const contract = JSON.parse(fs.readFileSync(path.join(dir, 'contracts', 'my-system.json'), 'utf8'));
  assert.equal(contract.name, 'my-system');
  assert.equal(contract.serves, null);
  assert.ok(contract.acceptance.includes('my-system.test.mjs'));

  const v = inProject(dir, 'verify.mjs', '--json');
  assert.equal(v.status, 0, v.stdout + v.stderr);
  const verified = JSON.parse(v.stdout);
  assert.deepEqual(verified.errors, []);
  assert.equal(verified.status['my-system'], 'open');

  const f = inProject(dir, 'frontier.mjs', '--json');
  assert.equal(f.status, 0, f.stdout + f.stderr);
  assert.deepEqual(JSON.parse(f.stdout).open.map((x) => x.name), ['my-system']);
});

test('the starter gate fails red for the right reason, not with a crash', () => {
  const dir = fresh();
  assert.equal(init(dir).status, 0);
  const name = JSON.parse(fs.readFileSync(path.join(dir, 'contracts', fs.readdirSync(path.join(dir, 'contracts'))[0]), 'utf8')).name;
  const g = spawnSync('node', ['--test', path.join(dir, 'acceptance', `${name}.test.mjs`)], { cwd: dir, encoding: 'utf8', timeout: 60000, env: Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('NODE_TEST_'))) });
  assert.notEqual(g.status, 0, 'a fresh root gate must fail until the system is built');
  assert.doesNotMatch(g.stdout + g.stderr, /ENOENT|MODULE_NOT_FOUND|SyntaxError/, 'it must fail as an unmet assertion, never as a crash');
});

test('refuses a non-empty target unless --force, and names the remedy', () => {
  const dir = fresh();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'keep.txt'), 'existing work\n');
  const r = init(dir);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /--force/);
  assert.ok(fs.existsSync(path.join(dir, 'keep.txt')));
  assert.ok(!fs.existsSync(path.join(dir, 'contracts')), 'a refused init must write nothing');

  const forced = init(dir, '--force');
  assert.equal(forced.status, 0, forced.stdout + forced.stderr);
  assert.ok(fs.existsSync(path.join(dir, 'keep.txt')), '--force adds to the directory, it does not wipe it');
  assert.ok(fs.existsSync(path.join(dir, 'contracts')));
});

test('rejects a root name the protocol cannot address', () => {
  const dir = fresh();
  const r = init(dir, '--root', 'my system');
  assert.notEqual(r.status, 0);
  // A refusal must be a refusal, never a crash that happens to exit non-zero.
  assert.doesNotMatch(r.stderr, /ENOENT|MODULE_NOT_FOUND|SyntaxError|at .*\.mjs:\d+/, r.stderr);
  assert.match(r.stderr, /name/i);
  assert.ok(!fs.existsSync(path.join(dir, 'contracts')));
});
