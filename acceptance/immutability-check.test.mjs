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

test('contracts are append-only; deprecations.log is append-only', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'b2m-imm-'));
  git(tmp, 'init', '-q');
  fs.mkdirSync(path.join(tmp, 'contracts'));
  fs.mkdirSync(path.join(tmp, 'laws'));
  fs.writeFileSync(path.join(tmp, 'contracts', 'a.json'), '{"name":"a"}\n');
  fs.writeFileSync(path.join(tmp, 'laws', 'deprecations.log'), '# header\n');
  git(tmp, 'add', '-A');
  git(tmp, 'commit', '-qm', 'c1');

  // no changes: OK
  assert.equal(check(tmp, 'HEAD').status, 0);
  // missing baseline: skip, OK
  assert.equal(check(tmp, 'no-such-ref').status, 0);

  // modifying a contract: violation
  fs.writeFileSync(path.join(tmp, 'contracts', 'a.json'), '{"name":"a","edited":true}\n');
  git(tmp, 'add', '-A');
  git(tmp, 'commit', '-qm', 'c2');
  const bad = check(tmp, 'HEAD~1');
  assert.equal(bad.status, 1);
  assert.match(bad.stdout, /IMMUTABILITY VIOLATION/);

  // restoring the contract and only adding a new one: OK again
  git(tmp, 'checkout', 'HEAD~1', '--', 'contracts/a.json');
  fs.writeFileSync(path.join(tmp, 'contracts', 'b.json'), '{"name":"b"}\n');
  git(tmp, 'add', '-A');
  git(tmp, 'commit', '-qm', 'c3');
  assert.equal(check(tmp, 'HEAD~2').status, 0);

  // appending to deprecations.log: OK
  fs.appendFileSync(path.join(tmp, 'laws', 'deprecations.log'), 'a superseded-by-b\n');
  git(tmp, 'add', '-A');
  git(tmp, 'commit', '-qm', 'c4');
  assert.equal(check(tmp, 'HEAD~1').status, 0);

  // rewriting deprecations.log: violation
  fs.writeFileSync(path.join(tmp, 'laws', 'deprecations.log'), '# rewritten\n');
  git(tmp, 'add', '-A');
  git(tmp, 'commit', '-qm', 'c5');
  const bad2 = check(tmp, 'HEAD~1');
  assert.equal(bad2.status, 1);
  assert.match(bad2.stdout, /append-only/);
});
