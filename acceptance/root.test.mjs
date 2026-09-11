// The completion criterion for the whole system. This gate only runs once the
// verifier has ACCEPTED every child contract in the same pass, so it does not
// re-run their gates — and it must not: an accurate status computation here
// would re-enter this very gate through root's own submissions (a completion
// gate is inherently self-referential). Structural mode breaks that cycle;
// the caller has already supplied the accurate half.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const run = (args) => spawnSync('node', args, { cwd: repoRoot, encoding: 'utf8', timeout: 60000 });

test('the frontier of build2me itself is empty', () => {
  const r = run([path.join(repoRoot, 'tools', 'frontier.mjs'), '--dir', repoRoot, '--json', '--structural']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual(JSON.parse(r.stdout).open, []);
});

test('the composed system answers as one', () => {
  const g = run([path.join(repoRoot, 'tools', 'graph.mjs'), '--dir', repoRoot, '--structural', '--format', 'json']);
  assert.equal(g.status, 0, g.stdout + g.stderr);
  const graph = JSON.parse(g.stdout);
  assert.ok(graph.nodes.length >= 11, `expected the full contract set, saw ${graph.nodes.length}`);
  assert.ok(graph.nodes.every((n) => n.status === 'done'), 'structurally, every contract must resolve Done');

  const d = run([path.join(repoRoot, 'tools', 'drill.mjs'), 'list']);
  assert.equal(d.status, 0, d.stdout + d.stderr);

  const m = run([path.join(repoRoot, 'tools', 'misalign.mjs'), '--json']);
  assert.equal(m.status, 0, m.stdout + m.stderr);
});
