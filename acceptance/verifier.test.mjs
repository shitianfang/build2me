import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const demo = path.join(repoRoot, 'acceptance', 'fixtures', 'demo');
const verify = (dir) => spawnSync('node', [path.join(repoRoot, 'tools', 'verify.mjs'), '--dir', dir, '--json'], { encoding: 'utf8', timeout: 120000 });

test('derives statuses and verdicts on the demo project', () => {
  const r = verify(demo);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.status.add, 'done');
  assert.equal(out.status.mul, 'open');
  assert.equal(out.status.calc, 'open');
  assert.equal(out.verdicts['add/sub-001'], 'ACCEPTED');
  assert.equal(out.verdicts['calc/dec-001'], 'SKETCH_ACCEPTED');
  assert.deepEqual(out.errors, []);
});

test('rejects unknown imports', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'b2m-'));
  fs.cpSync(demo, tmp, { recursive: true });
  const meta = path.join(tmp, 'impl', 'add', 'sub-001', 'meta.json');
  const m = JSON.parse(fs.readFileSync(meta, 'utf8'));
  m.imports = ['nope'];
  fs.writeFileSync(meta, JSON.stringify(m));
  const r = verify(tmp);
  assert.equal(r.status, 1);
  const out = JSON.parse(r.stdout);
  assert.ok(out.errors.some((e) => e.includes('unknown import "nope"')), JSON.stringify(out.errors));
});

test('reports GATE_FAILED for an implementation that fails its acceptance', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'b2m-'));
  fs.cpSync(demo, tmp, { recursive: true });
  fs.mkdirSync(path.join(tmp, 'impl', 'mul', 'sub-001'), { recursive: true });
  fs.writeFileSync(
    path.join(tmp, 'impl', 'mul', 'sub-001', 'meta.json'),
    JSON.stringify({ contract: 'mul', kind: 'implementation', imports: [], files: ['src/mul.mjs'], notes: 'still the throwing stub' }),
  );
  const r = verify(tmp);
  assert.equal(r.status, 1);
  const out = JSON.parse(r.stdout);
  assert.equal(out.verdicts['mul/sub-001'], 'GATE_FAILED');
  assert.equal(out.status.mul, 'open');
  assert.equal(out.status.calc, 'open');
});

test('rejects dependency cycles', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'b2m-'));
  fs.cpSync(demo, tmp, { recursive: true });
  // add: a submission importing calc -> calc -> (add, mul) -> add: cycle
  fs.mkdirSync(path.join(tmp, 'impl', 'add', 'sub-002'), { recursive: true });
  fs.writeFileSync(
    path.join(tmp, 'impl', 'add', 'sub-002', 'meta.json'),
    JSON.stringify({ contract: 'add', kind: 'decomposition', imports: ['calc'], files: [], notes: '' }),
  );
  const r = verify(tmp);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /dependency cycle/);
});
