// Laws as machine objects — the protocol's third object. Each fixture builds
// a throwaway copy of the demo project, adds declared laws under laws/, and
// checks that the verifier enforces them: a violated law fails verification
// naming id, dimension and statement; a satisfied law stays green; a
// malformed law file is a structural error, not a crash; and law checks run
// in the same sanitized environment as acceptance gates.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const demo = path.join(repoRoot, 'acceptance', 'fixtures', 'demo');

const scaffold = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'b2m-laws-'));
  fs.cpSync(demo, dir, { recursive: true });
  return dir;
};
const law = (dir, id, body) =>
  fs.writeFileSync(path.join(dir, 'laws', `${id}.json`), JSON.stringify({ id, ...body }, null, 2));
const verify = (dir) =>
  spawnSync('node', [path.join(repoRoot, 'tools', 'verify.mjs'), '--dir', dir, '--json'], { encoding: 'utf8', timeout: 120000 });

test('a violated declared law fails verification, naming id, dimension and statement', () => {
  const dir = scaffold();
  fs.writeFileSync(path.join(dir, 'FORBIDDEN.txt'), 'this file violates the law\n');
  law(dir, 'no-forbidden-file', {
    dimension: 'hygiene',
    statement: 'the project root carries no FORBIDDEN.txt',
    check: `node -e "process.exit(require('fs').existsSync('FORBIDDEN.txt') ? 1 : 0)"`,
  });
  const r = verify(dir);
  assert.equal(r.status, 1, `a violated law must fail verification — the kernel did not enforce it\n${r.stdout}${r.stderr}`);
  const out = JSON.parse(r.stdout);
  const hit = out.errors.find((e) => e.includes('no-forbidden-file'));
  assert.ok(hit, `errors must name the law id, got: ${JSON.stringify(out.errors)}`);
  assert.match(hit, /hygiene/, 'the violation must name the dimension');
  assert.match(hit, /FORBIDDEN\.txt/, 'the violation must carry the statement');
});

test('a satisfied declared law keeps verification green', () => {
  const dir = scaffold();
  law(dir, 'no-forbidden-file', {
    dimension: 'hygiene',
    statement: 'the project root carries no FORBIDDEN.txt',
    check: `node -e "process.exit(require('fs').existsSync('FORBIDDEN.txt') ? 1 : 0)"`,
  });
  const r = verify(dir);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual(JSON.parse(r.stdout).errors, []);
});

test('a malformed law object is a structural error that names the file and the missing field', () => {
  const dir = scaffold();
  law(dir, 'half-baked', { dimension: 'hygiene' }); // no statement, no check
  const r = verify(dir);
  assert.equal(r.status, 1);
  const out = JSON.parse(r.stdout);
  const hit = out.errors.find((e) => e.includes('half-baked'));
  assert.ok(hit, `errors must name the law file, got: ${JSON.stringify(out.errors)}`);
  assert.match(hit, /check|statement/, 'the error must name a missing field');
  assert.doesNotMatch(r.stderr, /at .*lib\.mjs:\d+/, 'a malformed law must not crash the kernel');
});

test('the id must match the file name, like a contract', () => {
  const dir = scaffold();
  fs.writeFileSync(path.join(dir, 'laws', 'alpha.json'), JSON.stringify({
    id: 'beta', dimension: 'hygiene', statement: 'ids are addresses', check: 'true',
  }));
  const r = verify(dir);
  assert.equal(r.status, 1);
  assert.ok(JSON.parse(r.stdout).errors.some((e) => e.includes('alpha') && e.includes('beta')));
});

test('law checks run sanitized: a nested node --test cannot lie its way past the law', () => {
  const dir = scaffold();
  fs.writeFileSync(path.join(dir, 'law-probe.test.mjs'), [
    "import test from 'node:test';",
    "import assert from 'node:assert/strict';",
    "test('always red', () => assert.fail('this law must be seen as violated'));",
    '',
  ].join('\n'));
  law(dir, 'nested-runner', {
    dimension: 'hygiene',
    statement: 'a failing nested test runner is a violation, not a silent pass',
    check: 'node --test law-probe.test.mjs',
  });
  // This gate itself runs under node --test, so NODE_TEST_CONTEXT is set in
  // OUR environment; without sanitization the nested runner exits 0 on failure.
  const r = verify(dir);
  assert.equal(r.status, 1, `the nested failing runner must count as a violation\n${r.stdout}${r.stderr}`);
  assert.ok(JSON.parse(r.stdout).errors.some((e) => e.includes('nested-runner')));
});
