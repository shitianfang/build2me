#!/usr/bin/env node
// Generates bench/queries.json: a labelled query set for the local relevance
// bench, derived from sample-docs.jsonl alone.
//
// The judged queries are hidden, so the bench reconstructs the only signal the
// corpus exposes: ids are "<topic>-<n>", and the documents of one topic share
// vocabulary that is rare elsewhere. Relevant set = the topic's documents.
// Three queries per topic, increasingly hard:
//   sig1  — the single rarest term all the topic's documents share
//   sig2  — the two rarest shared terms
//   mid   — two middling shared terms (common enough to attract other topics)
//   noisy — the rarest shared term plus the two commonest terms in the corpus,
//           which is where partial-coverage scoring earns or loses its keep
//   mix   — three rare terms from the topic's vocabulary that NOT every one of
//           its documents carries: a query written from one document, judged
//           against the whole topic
//
// It also emits `phraseQueries`: quoted exact-phrase queries lifted straight
// out of the corpus, each labelled with the documents a brute-force adjacency
// scan says hold it. Half of them are built to match NOTHING — a reversed
// pair, a pair straddling the title/body boundary, two words from the same
// document that are nowhere near each other — because a phrase filter that
// answers "everything" scores as well as a correct one on positives alone.
//
// Deterministic: same corpus in, same file out. Regenerate with
//   node bench/make-queries.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readCorpus } from '../lib/corpus.mjs';
import { tokenize } from '../lib/analyze.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const corpusFile = process.argv[2] ? path.resolve(process.argv[2]) : path.join(root, 'sample-docs.jsonl');
const out = path.join(root, 'bench', 'queries.json');

const { docs } = readCorpus(corpusFile);
const df = new Map();
for (const d of docs) for (const t of new Set(tokenize(`${d.title} ${d.body}`))) df.set(t, (df.get(t) ?? 0) + 1);

const topics = new Map();
for (const d of docs) {
  const topic = /^(.*)-\d+$/.exec(d.id)?.[1] ?? d.id;
  if (!topics.has(topic)) topics.set(topic, []);
  topics.get(topic).push(d);
}

const commonest = [...df.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, 2).map(([t]) => t);
const queries = [];
for (const [topic, group] of [...topics].sort(([a], [b]) => (a < b ? -1 : 1))) {
  if (group.length < 2) continue;
  const sets = group.map((d) => new Set(tokenize(`${d.title} ${d.body}`)));
  const shared = [...sets[0]].filter((t) => sets.every((s) => s.has(t)))
    .sort((a, b) => df.get(a) - df.get(b) || (a < b ? -1 : 1));
  if (shared.length === 0) continue;
  const relevant = group.map((d) => d.id).sort();
  const add = (kind, terms) => { if (terms.length > 0 && terms.every(Boolean)) queries.push({ id: `${topic}/${kind}`, q: terms.join(' '), relevant }); };
  add('sig1', shared.slice(0, 1));
  add('sig2', shared.slice(0, 2));
  const mid = Math.floor(shared.length / 2);
  add('mid', shared.slice(mid, mid + 2));
  add('noisy', [shared[0], ...commonest]);
  const union = [...new Set(sets.flatMap((s) => [...s]))]
    .filter((t) => !shared.includes(t))
    .sort((a, b) => df.get(a) - df.get(b) || (a < b ? -1 : 1));
  add('mix', union.slice(0, 3));
}

// --- exact-phrase queries -------------------------------------------------
// Ground truth is a brute-force scan of the corpus, independent of the index:
// a phrase matches a document when its tokens appear consecutively inside the
// title stream or inside the body stream (never across the two).
const streams = docs.map((d) => ({ id: d.id, fields: [tokenize(d.title), tokenize(d.body)] }));
const holders = (phrase) => streams
  .filter((s) => s.fields.some((f) => f.some((_, i) => phrase.every((t, k) => f[i + k] === t))))
  .map((s) => s.id);

const phraseQueries = [];
const seen = new Set();
const addPhrase = (kind, phrase) => {
  if (phrase.length < 2 || phrase.some((t) => t === undefined)) return;
  const key = phrase.join(' ');
  if (seen.has(key)) return;
  seen.add(key);
  const relevant = holders(phrase);
  // A phrase held by more than ten documents cannot be answered exactly inside
  // a ten-line answer, so it would measure the cap, not the matcher.
  if (relevant.length > 10) return;
  phraseQueries.push({ id: `${kind}/${phraseQueries.length}`, q: `"${key}"`, phrase, relevant });
};
streams.forEach((s, i) => {
  const [title, body] = s.fields;
  addPhrase('body3', body.slice(i % 5, (i % 5) + 3));            // a real phrase
  if (i % 2 === 0) addPhrase('title2', title.slice(0, 2));       // a real phrase in a title
  addPhrase('reversed', [body[4], body[3]]);                     // almost never a phrase
  addPhrase('straddle', [title.at(-1), body[0]]);                // the field boundary
  addPhrase('apart', [body[1], body[8]]);                        // same document, far apart
});

fs.writeFileSync(out, `${JSON.stringify({
  generatedFrom: path.relative(root, corpusFile),
  note: 'Generated by bench/make-queries.mjs — labelled proxy for the hidden judge. Do not hand-edit.',
  queries,
  phraseQueries,
}, null, 1)}\n`);
const matching = phraseQueries.filter((q) => q.relevant.length > 0).length;
console.log(`wrote ${path.relative(root, out)} — ${queries.length} queries over ${topics.size} topics, `
  + `${phraseQueries.length} phrase queries (${matching} matching, ${phraseQueries.length - matching} empty)`);
