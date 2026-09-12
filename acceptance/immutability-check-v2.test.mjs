// Fixed gate for immutability-check-v2, run red against the v1 script before
// the new implementation existed (v1 flags ANY modification, so the
// "descriptive edits are allowed" cases below fail for the right reason).
//
// v2 semantics: a contract's descriptive fields (title, nl_description,
// serves) may be edited in place — nothing builds against them and no verdict
// depends on them. The semantic core (name, interface, acceptance, env) is
// immutable: it changes only by revision (tools/revise.mjs). Deleting or
// renaming a contract file, or rewriting laws/deprecations.log, is never
// allowed.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const script = path.join(repoRoot, 'tools', 'check-immutability.sh');

const sh = (cwd, cmd, args) => spawnSync(cmd, args, { cwd, encoding: 'utf8', timeout: 60000 });
const git = (cwd, ...args) => {
  const r = sh(cwd, 'git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  return r;
};
const check = (cwd, base) => sh(cwd, 'bash', [script, base]);

const CONTRACT = {
  name: 'a', title: 'A', interface: 'a()', acceptance: 'true',
  nl_description: 'demo', serves: null, env: 'node>=20',
};

const repo = () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'b2m-imm2-'));
  git(tmp, 'init', '-q');
  fs.mkdirSync(path.join(tmp, 'contracts'));
  fs.mkdirSync(path.join(tmp, 'laws'));
  fs.writeFileSync(path.join(tmp, 'contracts', 'a.json'), `${JSON.stringify(CONTRACT, null, 2)}\n`);
  fs.writeFileSync(path.join(tmp, 'laws', 'deprecations.log'), '# header\n');
  git(tmp, 'add', '-A');
  git(tmp, 'commit', '-qm', 'c1');
  return tmp;
};
const commitContract = (tmp, fields) => {
  fs.writeFileSync(path.join(tmp, 'contracts', 'a.json'), `${JSON.stringify({ ...CONTRACT, ...fields }, null, 2)}\n`);
  git(tmp, 'add', '-A');
  git(tmp, 'commit', '-qm', 'edit');
};

test('no changes / missing baseline / additions: OK', () => {
  const tmp = repo();
  assert.equal(check(tmp, 'HEAD').status, 0);
  assert.equal(check(tmp, 'no-such-ref').status, 0);
  fs.writeFileSync(path.join(tmp, 'contracts', 'b.json'), `${JSON.stringify({ ...CONTRACT, name: 'b' }, null, 2)}\n`);
  git(tmp, 'add', '-A');
  git(tmp, 'commit', '-qm', 'add b');
  assert.equal(check(tmp, 'HEAD~1').status, 0);
});

test('editing descriptive fields in place is allowed', () => {
  const tmp = repo();
  commitContract(tmp, { title: 'A, better said', nl_description: 'clearer prose for searchers', serves: 'root' });
  const r = check(tmp, 'HEAD~1');
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test('editing the semantic core is a violation naming the field', () => {
  const tmp = repo();
  commitContract(tmp, { interface: 'a(x)' });
  const bad = check(tmp, 'HEAD~1');
  assert.equal(bad.status, 1);
  assert.match(bad.stdout + bad.stderr, /IMMUTABILITY VIOLATION/);
  assert.match(bad.stdout + bad.stderr, /interface/);
  assert.match(bad.stdout + bad.stderr, /revise/);
});

test('editing acceptance, adding unknown fields, breaking JSON: all violations', () => {
  for (const mutate of [
    (tmp) => commitContract(tmp, { acceptance: 'false' }),
    (tmp) => commitContract(tmp, { smuggled: true }),
    (tmp) => {
      fs.writeFileSync(path.join(tmp, 'contracts', 'a.json'), 'not json\n');
      git(tmp, 'add', '-A');
      git(tmp, 'commit', '-qm', 'break');
    },
  ]) {
    const tmp = repo();
    mutate(tmp);
    const bad = check(tmp, 'HEAD~1');
    assert.equal(bad.status, 1, bad.stdout + bad.stderr);
    assert.match(bad.stdout + bad.stderr, /IMMUTABILITY VIOLATION/);
  }
});

test('deleting a contract is a violation even with descriptive edits allowed', () => {
  const tmp = repo();
  fs.unlinkSync(path.join(tmp, 'contracts', 'a.json'));
  git(tmp, 'add', '-A');
  git(tmp, 'commit', '-qm', 'rm');
  const bad = check(tmp, 'HEAD~1');
  assert.equal(bad.status, 1);
  assert.match(bad.stdout, /IMMUTABILITY VIOLATION/);
});

test('deprecations.log stays append-only', () => {
  const tmp = repo();
  fs.appendFileSync(path.join(tmp, 'laws', 'deprecations.log'), 'a gone\n');
  git(tmp, 'add', '-A');
  git(tmp, 'commit', '-qm', 'dep');
  assert.equal(check(tmp, 'HEAD~1').status, 0);
  fs.writeFileSync(path.join(tmp, 'laws', 'deprecations.log'), '# rewritten\n');
  git(tmp, 'add', '-A');
  git(tmp, 'commit', '-qm', 'rewrite');
  const bad = check(tmp, 'HEAD~1');
  assert.equal(bad.status, 1);
  assert.match(bad.stdout, /append-only/);
});
