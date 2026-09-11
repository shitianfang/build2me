#!/usr/bin/env node
// Relevance tuner: scores bench/queries.json with the real rank() over a grid
// of PARAMS overrides and prints the best configurations.
//   node bench/sweep.mjs [--top 15]
// The judge's metric is P@10 against labelled sets; when |relevant| <= 10 that
// is recall@10 times a constant, so recall@10 is what is maximised here, with
// precision@3 as the tie-breaker for which of two equal-recall configs puts
// the right documents higher.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readCorpus } from '../lib/corpus.mjs';
import { buildIndex, writeIndex, openIndex } from '../lib/index-format.mjs';
import { tokenize } from '../lib/analyze.mjs';
import { rank, PARAMS } from '../lib/rank.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const top = Number(process.argv.includes('--top') ? process.argv[process.argv.indexOf('--top') + 1] : 12);
const dir = path.join(root, '.tmp', 'sweep-index');
const { docs, skipped } = readCorpus(path.join(root, 'sample-docs.jsonl'));
writeIndex(dir, buildIndex(docs, { docs: docs.length, skipped }));
const reader = openIndex(dir);
const { queries } = JSON.parse(fs.readFileSync(path.join(root, 'bench', 'queries.json'), 'utf8'));

const evaluate = (params) => {
  let recall = 0;
  let p3 = 0;
  let p10 = 0;
  for (const q of queries) {
    const relevant = new Set(q.relevant);
    const got = rank(reader, tokenize(q.q), 10, params);
    const hits = got.filter((id) => relevant.has(id)).length;
    recall += hits / relevant.size;
    p10 += hits / 10;
    p3 += got.slice(0, 3).filter((id) => relevant.has(id)).length / 3;
  }
  return { recall: recall / queries.length, p10: p10 / queries.length, p3: p3 / queries.length };
};

const grid = { k1: [0.6, 0.9, 1.2, 1.6, 2.0], b: [0.2, 0.4, 0.6, 0.75, 0.9], titleWeight: [1, 2, 3, 5, 8], coverage: [0, 1, 2, 2.5, 4, 8] };
const rows = [];
for (const k1 of grid.k1) for (const b of grid.b) for (const titleWeight of grid.titleWeight) for (const coverage of grid.coverage) {
  rows.push({ params: { k1, b, titleWeight, coverage }, ...evaluate({ k1, b, titleWeight, coverage }) });
}
rows.sort((x, y) => y.recall - x.recall || y.p3 - x.p3);
console.log(`${rows.length} configurations over ${queries.length} queries — best ${top}:`);
for (const r of rows.slice(0, top)) {
  console.log(`  recall@10 ${r.recall.toFixed(4)}  P@10 ${r.p10.toFixed(4)}  P@3 ${r.p3.toFixed(4)}   ${JSON.stringify(r.params)}`);
}
const cur = evaluate(PARAMS);
console.log(`  current: recall@10 ${cur.recall.toFixed(4)}  P@10 ${cur.p10.toFixed(4)}  P@3 ${cur.p3.toFixed(4)}   ${JSON.stringify(PARAMS)}`);
fs.rmSync(dir, { recursive: true, force: true });
