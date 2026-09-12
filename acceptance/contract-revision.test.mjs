// Fixed gate for the contract-revision contract, written and run red against a
// no-op reference implementation BEFORE the real tool existed (protocol rule:
// a gate must fail for the right reasons first).
//
// What revision means here: a contract is never edited — one command publishes
// the successor, deprecates the predecessor with a machine-readable
// superseded-by pointer, and the frontier immediately lists every reopened
// dependent together with the successor it must re-point at. Deprecation
// reopens downstream; revision is that plus a destination.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const demo = path.join(repoRoot, 'acceptance', 'fixtures', 'demo');
const tool = (name, dir, ...args) =>
  spawnSync('node', [path.join(repoRoot, 'tools', name), ...args, '--dir', dir], { encoding: 'utf8', timeout: 120000 });
const revise = (dir, ...args) => tool('revise.mjs', dir, ...args);

const freshCopy = () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'b2m-rev-'));
  fs.cpSync(demo, tmp, { recursive: true });
  return tmp;
};
const logOf = (dir) => fs.readFileSync(path.join(dir, 'laws', 'deprecations.log'), 'utf8');
const contractsOf = (dir) => fs.readdirSync(path.join(dir, 'contracts')).sort();

test('revises a contract: successor published, predecessor deprecated with a superseded-by pointer', () => {
  const tmp = freshCopy();
  const before = logOf(tmp);

  const r = revise(tmp, 'add', '--set', 'interface=add(a: bigint, b: bigint): bigint', '--reason', 'ints became bigints');
  assert.equal(r.status, 0, r.stdout + r.stderr);

  // The successor is a full, valid contract: changed field applied, the rest inherited.
  const succ = JSON.parse(fs.readFileSync(path.join(tmp, 'contracts', 'add-v2.json'), 'utf8'));
  assert.equal(succ.name, 'add-v2');
  assert.equal(succ.interface, 'add(a: bigint, b: bigint): bigint');
  assert.equal(succ.title, 'Addition');
  assert.equal(succ.serves, 'calc');

  // Exactly one appended log line, carrying the machine-readable pointer.
  const after = logOf(tmp);
  assert.ok(after.startsWith(before), 'deprecations.log must be appended to, never rewritten');
  const lines = after.slice(before.length).split('\n').filter((l) => l.trim() !== '');
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^add\s+superseded-by:add-v2\s+ints became bigints$/);

  // The verifier sees the whole move: predecessor deprecated, successor Open,
  // dependent reopened (its submission degraded back to a sketch).
  const v = JSON.parse(tool('verify.mjs', tmp, '--json').stdout);
  assert.equal(v.status.add, 'deprecated');
  assert.equal(v.status['add-v2'], 'open');
  assert.equal(v.status.calc, 'open');
  assert.equal(v.verdicts['calc/dec-001'], 'SKETCH_ACCEPTED');
});

test('the reopened dependent surfaces on the frontier, pointing at the successor', () => {
  const tmp = freshCopy();
  assert.equal(revise(tmp, 'add', '--set', 'acceptance=node --test test/add.test.mjs # v2', '--reason', 'gate revised').status, 0);

  const out = JSON.parse(tool('frontier.mjs', tmp, '--json').stdout);
  const names = out.open.map((x) => x.name);
  // add-v2 is new open work; calc can never close through a submission that
  // imports a deprecated contract, so it is actionable NOW (re-point), even
  // though mul is still open too.
  assert.ok(names.includes('add-v2'), `add-v2 missing from frontier: ${names}`);
  assert.ok(names.includes('mul'), `mul missing from frontier: ${names}`);
  const calc = out.open.find((x) => x.name === 'calc');
  assert.ok(calc, `calc (reopened dependent) missing from frontier: ${names}`);
  assert.deepEqual(calc.repairs, [{ import: 'add', successor: 'add-v2' }]);

  // Structural mode lists the same reopened work.
  const st = JSON.parse(tool('frontier.mjs', tmp, '--json', '--structural').stdout);
  assert.ok(st.open.some((x) => x.name === 'calc'));
});

test('a dependent with a deprecation-free path to Done stays off the frontier', () => {
  const tmp = freshCopy();
  // Give calc a second submission that does not touch the deprecated region:
  // the cascade can still close calc through it, so calc needs no repair.
  const d = path.join(tmp, 'impl', 'calc', 'dec-002');
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'meta.json'), JSON.stringify({
    contract: 'calc', kind: 'decomposition', imports: ['mul'], files: ['src/calc.mjs'], notes: 'deprecation-free alternative path',
  }, null, 2));
  assert.equal(revise(tmp, 'add', '--set', 'title=Addition v2', '--reason', 'r').status, 0);

  const out = JSON.parse(tool('frontier.mjs', tmp, '--json').stdout);
  assert.ok(!out.open.some((x) => x.name === 'calc'), 'calc still has a live path and must not be listed');
});

test('iteration: revising the successor auto-numbers the next version', () => {
  const tmp = freshCopy();
  assert.equal(revise(tmp, 'add', '--set', 'title=Addition v2', '--reason', 'r1').status, 0);
  const r = revise(tmp, 'add-v2', '--set', 'title=Addition v3', '--reason', 'r2');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.ok(fs.existsSync(path.join(tmp, 'contracts', 'add-v3.json')));
  const lines = logOf(tmp).split('\n').filter((l) => l.trim() !== '' && !l.startsWith('#'));
  assert.match(lines[1], /^add-v2\s+superseded-by:add-v3\s+r2$/);
});

test('refuses a revision that changes nothing', () => {
  const tmp = freshCopy();
  const cBefore = contractsOf(tmp);
  const lBefore = logOf(tmp);
  assert.notEqual(revise(tmp, 'add', '--reason', 'x').status, 0, 'no --set/--file must be refused');
  assert.notEqual(revise(tmp, 'add', '--set', 'title=Addition', '--reason', 'x').status, 0, 'identical value must be refused');
  assert.deepEqual(contractsOf(tmp), cBefore);
  assert.equal(logOf(tmp), lBefore);
});

test('refusals leave no half-state behind', () => {
  const tmp = freshCopy();
  const cBefore = contractsOf(tmp);
  const lBefore = logOf(tmp);
  assert.notEqual(revise(tmp, 'no-such', '--set', 'title=X', '--reason', 'x').status, 0);
  assert.notEqual(revise(tmp, 'add', '--as', 'calc', '--set', 'title=X', '--reason', 'x').status, 0, 'successor name collision must be refused');
  assert.deepEqual(contractsOf(tmp), cBefore);
  assert.equal(logOf(tmp), lBefore);

  // An already-deprecated contract is not revised twice: revise its successor.
  assert.equal(revise(tmp, 'add', '--set', 'title=Addition v2', '--reason', 'r').status, 0);
  const cAfter = contractsOf(tmp);
  const lAfter = logOf(tmp);
  assert.notEqual(revise(tmp, 'add', '--set', 'title=Addition again', '--reason', 'r2').status, 0);
  assert.deepEqual(contractsOf(tmp), cAfter, 'a refused revision must not leave a successor file');
  assert.equal(logOf(tmp), lAfter);
});
