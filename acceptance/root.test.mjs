// The completion criterion for the whole system: the repository's own
// frontier is empty. This gate only runs once every child contract of root
// is Done — until then, verify reports root's decomposition as
// SKETCH_ACCEPTED and never executes this file.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('the frontier of build2me itself is empty', () => {
  const r = spawnSync('node', [path.join(repoRoot, 'tools', 'frontier.mjs'), '--dir', repoRoot, '--json'], { encoding: 'utf8', timeout: 300000 });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const out = JSON.parse(r.stdout);
  assert.deepEqual(out.open, []);
});
