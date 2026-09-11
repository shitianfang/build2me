#!/usr/bin/env node
// Hidden judge for bench 002. Usage: node judge.mjs <target-dir> [--phrases]
// Generates the judged corpus fresh (deterministic seed), runs the target's
// search.mjs, prints one JSON result. Never shown to any arm.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const target = process.argv[2];
const withPhrases = process.argv.includes('--phrases');
if (!target) { console.error('usage: node judge.mjs <target-dir> [--phrases]'); process.exit(1); }
const mjs = path.join(target, 'search.mjs');
if (!fs.existsSync(mjs)) { console.log(JSON.stringify({ error: `missing artifact: ${mjs}` })); process.exit(1); }

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'judge-002-'));
const g = spawnSync('node', [path.join(here, 'gen.mjs'), work], { encoding: 'utf8', timeout: 120000 });
if (g.status !== 0) { console.log(JSON.stringify({ error: `gen failed: ${g.stderr}` })); process.exit(1); }
const corpus = path.join(work, 'docs.jsonl');
const meta = JSON.parse(fs.readFileSync(path.join(work, 'meta.json'), 'utf8'));

const run = (args, timeout = 60000) => spawnSync('node', [mjs, ...args], { cwd: target, encoding: 'utf8', timeout });

// robustness + build
const t0 = Date.now();
const idx = run(['index', corpus], 300000);
const buildMs = Date.now() - t0;
const res = { build_exit: idx.status, build_ms: buildMs };
const st = run(['stats']);
let stats = null;
try { stats = JSON.parse(st.stdout); } catch { /* judged below */ }
res.stats = stats;
res.robustness = { exit_ok: idx.status === 0, skipped_exact: stats?.skipped === meta.malformed };
res.size_ratio = stats && stats.indexBytes ? +(stats.indexBytes / fs.statSync(corpus).size).toFixed(4) : null;

const p10 = (qs) => {
  const times = [];
  let sum = 0; let failures = 0;
  for (const q of qs) {
    const t = Date.now();
    const r = run(['query', q.query]);
    times.push(Date.now() - t);
    if (r.status !== 0) { failures++; continue; }
    const got = r.stdout.trim().split('\n').filter(Boolean).slice(0, 10);
    const rel = new Set(q.relevant);
    sum += got.filter((id) => rel.has(id)).length / 10;
  }
  times.sort((a, b) => a - b);
  return { mean_p10: +(sum / qs.length).toFixed(4), p95_ms: times[Math.floor(times.length * 0.95)] ?? null, failures };
};
res.terms = p10(JSON.parse(fs.readFileSync(path.join(work, 'queries.json'), 'utf8')));
if (withPhrases) res.phrases = p10(JSON.parse(fs.readFileSync(path.join(work, 'phrases.json'), 'utf8')));
console.log(JSON.stringify(res, null, 1));
process.exit(0);
