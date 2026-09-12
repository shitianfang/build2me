// The completion criterion for the whole system, v2. It runs only once the
// verifier has ACCEPTED every child in the same pass, so it must stay
// STRUCTURAL (an accurate status query here would re-enter this very gate —
// the v1 self-reference lesson still applies).
//
// What v2 fixes: v1 demanded every node be Done, which no repository with a
// revised contract can ever satisfy again — the first live revision would
// have turned main permanently red. Complete means NOTHING IS OPEN: deprecated
// predecessors are explored history on the map, not outstanding debt.
// Run red for the right reason before publishing: executed while
// immutability-check-v2 and the reopened root were still Open.
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

test('the composed system answers as one, with revision history tolerated', () => {
  const g = run([path.join(repoRoot, 'tools', 'graph.mjs'), '--dir', repoRoot, '--structural', '--format', 'json']);
  assert.equal(g.status, 0, g.stdout + g.stderr);
  const graph = JSON.parse(g.stdout);
  assert.ok(graph.nodes.length >= 14, `expected the full contract set, saw ${graph.nodes.length}`);
  assert.ok(graph.nodes.every((n) => n.status !== 'open'),
    `structurally, nothing may remain Open: ${graph.nodes.filter((n) => n.status === 'open').map((n) => n.name)}`);
  // Every deprecated statement must point somewhere: a dead end with no
  // successor is unfinished revision work.
  for (const n of graph.nodes.filter((x) => x.status === 'deprecated')) {
    assert.ok(typeof n.successor === 'string' && n.successor.length > 0,
      `deprecated ${n.name} has no successor pointer`);
  }

  const d = run([path.join(repoRoot, 'tools', 'drill.mjs'), 'list']);
  assert.equal(d.status, 0, d.stdout + d.stderr);

  const m = run([path.join(repoRoot, 'tools', 'misalign.mjs'), '--json']);
  assert.equal(m.status, 0, m.stdout + m.stderr);
});
