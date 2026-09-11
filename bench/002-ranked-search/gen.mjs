#!/usr/bin/env node
// Deterministic corpus + hidden query/qrel generator for bench 002.
// Usage: node gen.mjs <out-dir> [--seed N] [--docs N] [--dev]
//   --dev: small development sample (docs only, no query files)
// Committed BEFORE any arm runs; arms never see the judged seed's output.
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const out = args[0];
if (!out) { console.error('usage: node gen.mjs <out-dir> [--seed N] [--docs N] [--dev]'); process.exit(1); }
const flag = (n, d) => { const i = args.indexOf(n); return i === -1 ? d : Number(args[i + 1]); };
const SEED = flag('--seed', 20260911);
const NDOCS = flag('--docs', 2000);
const dev = args.includes('--dev');

let s = SEED >>> 0;
const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
const pick = (a) => a[Math.floor(rnd() * a.length)];
const int = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));

// pseudo-words: pronounceable, overlapping vocabulary
const syl = ['ba','co','di','fe','gu','ha','ki','lo','mu','ne','pa','ri','so','tu','ve','wa','xo','yu','za','bri'];
const word = () => pick(syl) + pick(syl) + (rnd() < 0.5 ? pick(syl) : '');
const uniqWords = (n, taken) => {
  const ws = new Set();
  while (ws.size < n) { const w = word(); if (!taken.has(w)) { ws.add(w); taken.add(w); } }
  return [...ws];
};

const taken = new Set();
const common = uniqWords(400, taken);            // shared vocabulary
const NTOPICS = 40;
const topics = Array.from({ length: NTOPICS }, () => uniqWords(4, taken)); // rare, topic-specific

const perTopic = Math.floor(NDOCS / NTOPICS);
const docs = [];
for (let t = 0; t < NTOPICS; t++) {
  for (let d = 0; d < perTopic; d++) {
    const id = `doc-${t}-${d}`;
    const len = int(60, 130);
    const body = [];
    for (let i = 0; i < len; i++) {
      const r = rnd();
      if (r < 0.72) body.push(pick(common));
      else if (r < 0.92) body.push(pick(topics[t]));
      else body.push(pick(topics[int(0, NTOPICS - 1)])); // cross-topic noise
    }
    const title = `${pick(topics[t])} ${pick(common)} ${pick(common)}`;
    docs.push({ id, topic: t, title, body: body.join(' ') });
  }
}

// phrases: individually-common words whose ADJACENCY is rare
const NPHRASES = 20;
const phrases = [];
for (let p = 0; p < NPHRASES; p++) {
  const ws = [pick(common), pick(common), pick(common)];
  const rel = [];
  for (let k = 0; k < 8; k++) {
    const doc = pick(docs);
    if (rel.includes(doc.id)) { k--; continue; }
    const words = doc.body.split(' ');
    const at = int(0, words.length - 1);
    words.splice(at, 0, ...ws);
    doc.body = words.join(' ');
    rel.push(doc.id);
  }
  for (let k = 0; k < 25; k++) { // scattered non-adjacent decoys
    const doc = pick(docs);
    if (rel.includes(doc.id)) { k--; continue; }
    const words = doc.body.split(' ');
    for (const w of ws) words.splice(int(0, Math.max(0, words.length - 5)) + int(0, 4), 0, w);
    doc.body = words.join(' ');
  }
  phrases.push({ query: `"${ws.join(' ')}"`, relevant: rel });
}

// shuffle, serialize, inject malformed lines
for (let i = docs.length - 1; i > 0; i--) { const j = int(0, i); [docs[i], docs[j]] = [docs[j], docs[i]]; }
const lines = docs.map((d) => JSON.stringify({ id: d.id, title: d.title, body: d.body }));
const NMAL = dev ? 5 : 25;
for (let m = 0; m < NMAL; m++) {
  const l = JSON.stringify({ id: `broken-${m}`, title: 'trunc', body: 'trunc' });
  lines.splice(int(0, lines.length), 0, m % 2 === 0 ? l.slice(0, int(5, l.length - 2)) : '{"id":"nofields"}');
}
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, dev ? 'sample-docs.jsonl' : 'docs.jsonl'), lines.join('\n') + '\n');

if (!dev) {
  // term queries: 2 topic words (+1 common 50% of the time); relevant = that topic's docs
  const byTopic = new Map();
  for (const d of docs) { if (!byTopic.has(d.topic)) byTopic.set(d.topic, []); byTopic.get(d.topic).push(d.id); }
  // mixed difficulty: even topics get two rare topic words (easy), odd topics
  // get one topic word buried in two common words (ranking quality shows here)
  const queries = topics.map((tw, t) => ({
    query: t % 2 === 0 ? `${tw[0]} ${tw[1]}` : `${tw[0]} ${pick(common)} ${pick(common)}`,
    relevant: byTopic.get(t),
  }));
  fs.writeFileSync(path.join(out, 'queries.json'), JSON.stringify(queries, null, 1));
  fs.writeFileSync(path.join(out, 'phrases.json'), JSON.stringify(phrases, null, 1));
  fs.writeFileSync(path.join(out, 'meta.json'), JSON.stringify({ seed: SEED, docs: docs.length, malformed: NMAL }, null, 1));
}
console.log(`${dev ? 'dev sample' : 'judge corpus'}: ${docs.length} docs, ${NMAL} malformed -> ${out}`);
