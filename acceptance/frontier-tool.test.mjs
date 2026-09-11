import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const demo = path.join(repoRoot, 'acceptance', 'fixtures', 'demo');

test('ranks open leaves by closability', () => {
  const r = spawnSync('node', [path.join(repoRoot, 'tools', 'frontier.mjs'), '--dir', demo, '--json'], { encoding: 'utf8', timeout: 120000 });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const out = JSON.parse(r.stdout);
  // mul is the only actionable leaf: add is Done, calc's sketch still imports Open mul.
  assert.equal(out.open.length, 1);
  assert.equal(out.open[0].name, 'mul');
  // closing mul structurally closes calc -> closability 1.
  assert.equal(out.open[0].closability, 1);
});

test('structural mode agrees on the demo', () => {
  const r = spawnSync('node', [path.join(repoRoot, 'tools', 'frontier.mjs'), '--dir', demo, '--json', '--structural'], { encoding: 'utf8', timeout: 120000 });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const out = JSON.parse(r.stdout);
  assert.deepEqual(out.open.map((x) => x.name), ['mul']);
});
