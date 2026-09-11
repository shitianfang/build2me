#!/usr/bin/env node
// The measuring stick for the five judged dimensions, and the engine behind
// every declared law in laws/.
//
//   node bench/measure.mjs                          # measure everything, print a report
//   node bench/measure.mjs --json                   # same, as JSON
//   node bench/measure.mjs --only size --assert sizeRatio'<='0.30
//
// --assert <key><op><value> (repeatable) turns a measurement into a gate: it
// exits 1 naming the key, the floor and the value it actually got. Laws use
// --only so each law pays for its own dimension and nothing else.
//
// Everything runs against a throwaway working directory under .tmp/, so the
// project's own ./index is never touched and two measurements never collide.
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { openIndex } from '../lib/index-format.mjs';
import { tokenize } from '../lib/analyze.mjs';
import { rank } from '../lib/rank.mjs';
import { quotedPhrases, phraseDocIds } from '../lib/phrase.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (name, fallback) => { const i = args.indexOf(name); return i === -1 ? fallback : args[i + 1]; };
const corpusFile = path.resolve(flag('--corpus', path.join(root, 'sample-docs.jsonl')));
const only = new Set((flag('--only', 'size,speed,relevance,robustness,phrase')).split(',').map((s) => s.trim()));
const latencyRuns = Number(flag('--runs', 30));
const asserts = args.map((a, i) => (a === '--assert' ? args[i + 1] : null)).filter(Boolean);
const RESULTS = 10;

const scratch = path.join(root, '.tmp');
fs.mkdirSync(scratch, { recursive: true });
const work = fs.mkdtempSync(path.join(scratch, 'measure-'));
const cli = (...argv) => spawnSync(process.execPath, [path.join(root, 'search.mjs'), ...argv], { cwd: work, encoding: 'utf8', timeout: 120000 });

const report = { corpus: path.relative(root, corpusFile), corpusBytes: fs.statSync(corpusFile).size };
try {
  // Indexing is the precondition for every dimension, and is itself the
  // robustness measurement: a corpus with malformed lines must exit 0.
  const started = process.hrtime.bigint();
  const indexed = cli('index', corpusFile);
  report.indexMs = Number(process.hrtime.bigint() - started) / 1e6;
  report.exitCode = indexed.status;
  if (indexed.status !== 0) throw new Error(`indexing failed (exit ${indexed.status}): ${indexed.stderr}`);
  const stats = JSON.parse(cli('stats').stdout);
  report.docs = stats.docs;
  report.skipped = stats.skipped;
  report.indexBytes = stats.indexBytes;

  if (only.has('size')) report.sizeRatio = stats.indexBytes / report.corpusBytes;

  if (only.has('relevance')) {
    const { queries } = JSON.parse(fs.readFileSync(path.join(root, 'bench', 'queries.json'), 'utf8'));
    const reader = openIndex(path.join(work, 'index'));
    let p10 = 0;
    let recall = 0;
    let perfect = 0;
    for (const q of queries) {
      const got = rank(reader, tokenize(q.q), RESULTS);
      const relevant = new Set(q.relevant);
      const hit = got.filter((id) => relevant.has(id)).length;
      p10 += hit / RESULTS;
      recall += hit / relevant.size;
      if (hit === relevant.size) perfect++;
    }
    report.queries = queries.length;
    report.meanP10 = p10 / queries.length;
    report.meanRecall10 = recall / queries.length;
    report.fullyRecalled = perfect / queries.length;
  }

  if (only.has('phrase')) {
    // Exactness, not ranking: a quoted query must return ALL and ONLY the
    // documents holding the phrase, so precision and recall are both pass/fail
    // per query and the floor is 1.0. The labelled sets come from a brute-force
    // scan in bench/make-queries.mjs, and a third of them are empty on purpose —
    // a filter that never filters scores perfectly on matching phrases alone.
    const { phraseQueries } = JSON.parse(fs.readFileSync(path.join(root, 'bench', 'queries.json'), 'utf8'));
    const reader = openIndex(path.join(work, 'index'));
    let precision = 0;
    let recall = 0;
    for (const q of phraseQueries) {
      const allowed = phraseDocIds(reader, quotedPhrases(q.q));
      const got = rank(reader, tokenize(q.q), allowed ? reader.docCount : RESULTS)
        .filter((id) => allowed === null || allowed.has(id)).slice(0, RESULTS);
      const relevant = new Set(q.relevant);
      const hit = got.filter((id) => relevant.has(id)).length;
      precision += got.length === 0 ? (relevant.size === 0 ? 1 : 0) : hit / got.length;
      recall += relevant.size === 0 ? 1 : hit / Math.min(relevant.size, RESULTS);
    }
    report.phraseQueries = phraseQueries.length;
    report.phraseEmpty = phraseQueries.filter((q) => q.relevant.length === 0).length;
    report.phrasePrecision = phraseQueries.length > 0 ? precision / phraseQueries.length : 0;
    report.phraseRecall = phraseQueries.length > 0 ? recall / phraseQueries.length : 0;
  }

  if (only.has('speed')) {
    const { queries, phraseQueries = [] } = JSON.parse(fs.readFileSync(path.join(root, 'bench', 'queries.json'), 'utf8'));
    // Half term queries, half phrase queries: the p95 must cover both paths,
    // and a phrase query is the one that decodes positions.
    const half = Math.max(1, Math.floor(latencyRuns / 2));
    const pick = (list, n) => list.filter((_, i) => i % Math.max(1, Math.floor(list.length / n)) === 0).slice(0, n);
    const sample = [...pick(queries, latencyRuns - half), ...pick(phraseQueries, half)];
    const timings = [];
    const bare = [];
    const took = (fn) => { const t0 = process.hrtime.bigint(); const r = fn(); return [Number(process.hrtime.bigint() - t0) / 1e6, r]; };
    for (const q of sample) {
      // An empty node process, interleaved with every measured query, so both
      // samples carry the same machine and the difference between them is this
      // program's own cost. Most of a query is node starting up; a floor on the
      // raw number is mostly a floor on the machine's mood, which is why
      // `overheadMs` — not p95 alone — is what the speed law tightens.
      const [empty] = took(() => spawnSync(process.execPath, ['-e', '0'], { cwd: work, timeout: 120000 }));
      const [ms, r] = took(() => cli('query', q.q));
      if (r.status !== 0) throw new Error(`query "${q.q}" failed: ${r.stderr}`);
      timings.push(ms);
      bare.push(empty);
    }
    timings.sort((a, b) => a - b);
    bare.sort((a, b) => a - b);
    report.queryRuns = timings.length;
    report.p50Ms = timings[Math.floor(timings.length * 0.5)];
    report.p95Ms = timings[Math.max(0, Math.ceil(timings.length * 0.95) - 1)];
    report.maxMs = timings[timings.length - 1];
    report.bareNodeMs = bare[0];
    // The FASTEST query over the FASTEST empty process: the least-contended run
    // of each is the one sample that measures the program instead of the host,
    // and their ratio is invariant when load stretches both. Milliseconds are
    // mostly a property of the machine; this ratio is a property of the code,
    // which is why it, not p95, is what laws/query-latency.json tightens.
    report.overheadMs = timings[0] - bare[0];
    report.startupRatio = timings[0] / bare[0];
  }
} finally {
  fs.rmSync(work, { recursive: true, force: true });
}

const round = (v) => (typeof v === 'number' && !Number.isInteger(v) ? Number(v.toFixed(4)) : v);
if (args.includes('--json')) {
  console.log(JSON.stringify(Object.fromEntries(Object.entries(report).map(([k, v]) => [k, round(v)])), null, 2));
} else if (asserts.length === 0) {
  for (const [k, v] of Object.entries(report)) console.log(`  ${k.padEnd(16)} ${round(v)}`);
}

const OPS = { '<=': (a, b) => a <= b, '>=': (a, b) => a >= b, '==': (a, b) => a === b, '<': (a, b) => a < b, '>': (a, b) => a > b };
let failed = 0;
for (const expr of asserts) {
  const m = /^([A-Za-z0-9_]+)(<=|>=|==|<|>)(-?[0-9.]+)$/.exec(expr);
  if (!m) { console.error(`measure: cannot parse assertion "${expr}"`); failed++; continue; }
  const [, key, op, raw] = m;
  const actual = report[key];
  const want = Number(raw);
  if (actual === undefined) { console.error(`measure: nothing measured for "${key}" (is it in --only?)`); failed++; continue; }
  if (!OPS[op](actual, want)) {
    console.error(`measure: ${key} = ${round(actual)}, floor is ${key} ${op} ${want} — the level this project holds has been lost`);
    failed++;
  } else {
    console.log(`ok ${key} = ${round(actual)} (${op} ${want})`);
  }
}
process.exit(failed > 0 ? 1 : 0);
