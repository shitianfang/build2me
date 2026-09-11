// The full life of a contract tree, end to end:
// a sketched parent over one Done and one Open child; implementing the Open
// child flips the parent to Done by cascade and empties the frontier.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const demo = path.join(repoRoot, 'acceptance', 'fixtures', 'demo');
const run = (tool, dir, ...extra) =>
  spawnSync('node', [path.join(repoRoot, 'tools', tool), '--dir', dir, '--json', ...extra], { encoding: 'utf8', timeout: 120000 });

test('closing the open leaf cascades the parent to Done', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'b2m-flow-'));
  fs.cpSync(demo, tmp, { recursive: true });

  // Before: mul is the frontier, calc is sketched.
  let frontier = JSON.parse(run('frontier.mjs', tmp).stdout);
  assert.deepEqual(frontier.open.map((x) => [x.name, x.closability]), [['mul', 1]]);
  let verify = JSON.parse(run('verify.mjs', tmp).stdout);
  assert.equal(verify.status.calc, 'open');
  assert.equal(verify.verdicts['calc/dec-001'], 'SKETCH_ACCEPTED');

  // An agent implements the open leaf and submits.
  fs.writeFileSync(path.join(tmp, 'src', 'mul.mjs'), 'export function mul(a, b) {\n  return a * b;\n}\n');
  fs.mkdirSync(path.join(tmp, 'impl', 'mul', 'sub-001'), { recursive: true });
  fs.writeFileSync(
    path.join(tmp, 'impl', 'mul', 'sub-001', 'meta.json'),
    JSON.stringify({ contract: 'mul', kind: 'implementation', imports: [], files: ['src/mul.mjs'], notes: '' }),
  );

  // After: mul ACCEPTED, calc auto-resolves through its own integration gate.
  const r = run('verify.mjs', tmp);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  verify = JSON.parse(r.stdout);
  assert.equal(verify.status.mul, 'done');
  assert.equal(verify.status.calc, 'done');
  assert.equal(verify.verdicts['mul/sub-001'], 'ACCEPTED');
  assert.equal(verify.verdicts['calc/dec-001'], 'ACCEPTED');

  frontier = JSON.parse(run('frontier.mjs', tmp).stdout);
  assert.deepEqual(frontier.open, []);
});
