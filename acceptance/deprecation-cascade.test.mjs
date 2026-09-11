// Fixed gate for the deprecation-cascade contract. Published BEFORE any
// implementation attempt; implementers must not modify this file.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const demo = path.join(repoRoot, 'acceptance', 'fixtures', 'demo');
const deprecate = (dir, ...args) =>
  spawnSync('node', [path.join(repoRoot, 'tools', 'deprecate.mjs'), ...args, '--dir', dir], { encoding: 'utf8', timeout: 60000 });
const verify = (dir) =>
  spawnSync('node', [path.join(repoRoot, 'tools', 'verify.mjs'), '--dir', dir, '--json'], { encoding: 'utf8', timeout: 120000 });

const freshCopy = () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'b2m-dep-'));
  fs.cpSync(demo, tmp, { recursive: true });
  return tmp;
};

test('deprecates a contract: appends to the log and reports direct dependents', () => {
  const tmp = freshCopy();
  const before = fs.readFileSync(path.join(tmp, 'laws', 'deprecations.log'), 'utf8');

  const r = deprecate(tmp, 'add', '--reason', 'superseded-by-add2');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  // calc's decomposition imports add -> calc is a direct dependent and must be named.
  assert.match(r.stdout, /calc/);

  const after = fs.readFileSync(path.join(tmp, 'laws', 'deprecations.log'), 'utf8');
  assert.ok(after.startsWith(before), 'deprecations.log must be appended to, never rewritten');
  const lines = after.slice(before.length).split('\n').filter((l) => l.trim() !== '');
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^add\s+\S/);

  // The verifier must now hold the dependent open: add deprecated, calc degraded to sketch.
  const v = JSON.parse(verify(tmp).stdout);
  assert.equal(v.status.add, 'deprecated');
  assert.equal(v.status.calc, 'open');
  assert.equal(v.verdicts['calc/dec-001'], 'SKETCH_ACCEPTED');
});

test('refuses an unknown contract and leaves the log untouched', () => {
  const tmp = freshCopy();
  const before = fs.readFileSync(path.join(tmp, 'laws', 'deprecations.log'), 'utf8');
  const r = deprecate(tmp, 'no-such-contract', '--reason', 'x');
  assert.notEqual(r.status, 0);
  assert.equal(fs.readFileSync(path.join(tmp, 'laws', 'deprecations.log'), 'utf8'), before);
});

test('refuses to deprecate twice', () => {
  const tmp = freshCopy();
  assert.equal(deprecate(tmp, 'mul', '--reason', 'first').status, 0);
  const before = fs.readFileSync(path.join(tmp, 'laws', 'deprecations.log'), 'utf8');
  const r = deprecate(tmp, 'mul', '--reason', 'second');
  assert.notEqual(r.status, 0);
  assert.equal(fs.readFileSync(path.join(tmp, 'laws', 'deprecations.log'), 'utf8'), before);
});

test('requires a reason', () => {
  const tmp = freshCopy();
  const before = fs.readFileSync(path.join(tmp, 'laws', 'deprecations.log'), 'utf8');
  const r = deprecate(tmp, 'add');
  assert.notEqual(r.status, 0);
  assert.equal(fs.readFileSync(path.join(tmp, 'laws', 'deprecations.log'), 'utf8'), before);
});

test('a contract with no dependents reports none', () => {
  const tmp = freshCopy();
  const r = deprecate(tmp, 'calc', '--reason', 'demo-retired');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.doesNotMatch(r.stdout, /\badd\b.*dependent|dependent.*\badd\b/s);
});
