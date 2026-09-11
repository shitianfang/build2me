import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const demo = path.join(repoRoot, 'acceptance', 'fixtures', 'demo');
const graph = (...args) =>
  spawnSync('node', [path.join(repoRoot, 'tools', 'graph.mjs'), '--dir', demo, ...args], { encoding: 'utf8', timeout: 120000 });

test('json: nodes carry derived status, edges carry submission verdicts', () => {
  const r = graph('--format', 'json');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const out = JSON.parse(r.stdout);
  assert.deepEqual(out.nodes.map((n) => [n.name, n.status]), [['add', 'done'], ['calc', 'open'], ['mul', 'open']]);
  assert.deepEqual(out.edges.map((e) => [e.from, e.to, e.verdict]), [
    ['calc', 'add', 'SKETCH_ACCEPTED'],
    ['calc', 'mul', 'SKETCH_ACCEPTED'],
  ]);
});

test('mermaid: status classes and dashed sketch edges', () => {
  const r = graph();
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /^graph TD/);
  assert.match(r.stdout, /add\["add"\]:::done/);
  assert.match(r.stdout, /mul\["mul"\]:::open/);
  assert.match(r.stdout, /calc -\.-> mul/);
  assert.match(r.stdout, /classDef done/);
});

test('dot: valid digraph with dashed sketch edges', () => {
  const r = graph('--format', 'dot');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /^digraph build2me \{/);
  assert.match(r.stdout, /calc -> mul \[style=dashed\];/);
});

test('rejects an unknown format', () => {
  const r = graph('--format', 'png');
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /unknown --format/);
});
