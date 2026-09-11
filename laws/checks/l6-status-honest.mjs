// L6 — docs honesty: the status line each README shows ("N / M contracts
// Done") must equal what the DAG derives. Hand-typed status went stale twice
// in this repo's first day; this floor makes stale impossible to merge.
// Uses graph.mjs --structural (no gates, no law checks), so it cannot
// re-enter the verifier.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

const g = spawnSync('node', ['tools/graph.mjs', '--structural', '--format', 'json'], { encoding: 'utf8', timeout: 60000 });
if (g.status !== 0) {
  console.error(`graph.mjs failed: ${g.stderr}`);
  process.exit(1);
}
const nodes = JSON.parse(g.stdout).nodes;
const done = nodes.filter((n) => n.status === 'done').length;
const total = nodes.length;

const bad = [];
for (const [file, pattern] of [
  ['README.md', /(\d+)\s*\/\s*(\d+) contracts Done/],
  ['README.zh-CN.md', new RegExp('(\\d+)\\s*/\\s*(\\d+) \u5951\u7ea6 Done')],
]) {
  if (!fs.existsSync(file)) continue;
  const m = fs.readFileSync(file, 'utf8').match(pattern);
  if (!m) bad.push(`${file}: no status line matching ${pattern}`);
  else if (Number(m[1]) !== done || Number(m[2]) !== total) {
    bad.push(`${file}: says ${m[1]} / ${m[2]}, the DAG derives ${done} / ${total}`);
  }
}
if (bad.length > 0) {
  console.error(bad.join('\n'));
  process.exit(1);
}
