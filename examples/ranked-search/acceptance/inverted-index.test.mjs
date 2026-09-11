// Gate for contract "inverted-index".
// Owns the on-disk shape: round-trip fidelity, the "fully overwritten" rule,
// loud failure on a missing or corrupt index, and the size dimension
// (an index that is not much smaller than its corpus is a defect).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildIndex, writeIndex, openIndex } from '../lib/index-format.mjs';
import { readCorpus } from '../lib/corpus.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-index-'));
let seq = 0;
const freshDir = () => path.join(tmp, `idx-${seq++}`);
const bytesUnder = (dir) => fs.readdirSync(dir, { withFileTypes: true })
  .reduce((n, e) => n + (e.isDirectory() ? bytesUnder(path.join(dir, e.name)) : fs.statSync(path.join(dir, e.name)).size), 0);

const DOCS = [
  { id: 'alpha', title: 'red fish', body: 'the red fish swims and swims' },
  { id: 'beta', title: 'blue sky', body: 'the blue sky above' },
  { id: 'gamma', title: 'quiet', body: 'red sky at night the fish sleeps' },
];
const persisted = (docs = DOCS, meta = { docs: docs.length, skipped: 0 }) => {
  const dir = freshDir();
  writeIndex(dir, buildIndex(docs, meta));
  return openIndex(dir);
};

test('a written index reopens with the same documents, in the same order', () => {
  const r = persisted();
  assert.equal(r.docCount, 3);
  assert.deepEqual([0, 1, 2].map((i) => r.docId(i)), ['alpha', 'beta', 'gamma']);
  assert.ok(r.docLen(0) > 0 && r.docLen(1) > 0);
  assert.ok(r.avgDocLen > 0);
});

test('meta survives the round trip untouched', () => {
  const r = persisted(DOCS, { docs: 3, skipped: 7, corpus: 'x.jsonl' });
  assert.equal(r.meta.docs, 3);
  assert.equal(r.meta.skipped, 7);
  assert.equal(r.meta.corpus, 'x.jsonl');
});

test('postings carry per-document title and body frequencies, ascending by document', () => {
  const r = persisted();
  const fish = r.postings('fish');
  assert.deepEqual(fish.map((p) => p.doc), [0, 2]);
  assert.equal(fish[0].title, 1);          // "red fish" in alpha's title
  assert.equal(fish[0].body, 1);
  assert.equal(fish[1].title, 0);          // gamma mentions it only in the body
  assert.equal(fish[1].body, 1);

  const swims = r.postings('swims');
  assert.deepEqual(swims.map((p) => [p.doc, p.body, p.title]), [[0, 2, 0]]);

  const red = r.postings('red');
  assert.deepEqual(red.map((p) => p.doc), [0, 2]);
  assert.equal(red[0].title, 1);

  const the = r.postings('the');
  assert.deepEqual(the.map((p) => p.doc), [0, 1, 2]);
});

test('an unknown term has empty postings, and lookup is case-folded like the analyzer', () => {
  const r = persisted();
  assert.deepEqual(r.postings('zebra'), []);
  assert.deepEqual(r.postings(''), []);
  assert.deepEqual(r.postings('FISH').map((p) => p.doc), [0, 2]);
});

test('writing an index removes every trace of the previous one', () => {
  const dir = freshDir();
  writeIndex(dir, buildIndex(DOCS, { docs: 3, skipped: 0 }));
  fs.writeFileSync(path.join(dir, 'stale.bin'), 'left over from an older format');
  const before = fs.readdirSync(dir);
  assert.ok(before.includes('stale.bin'));

  writeIndex(dir, buildIndex([{ id: 'only', title: 'lonely', body: 'word' }], { docs: 1, skipped: 2 }));
  assert.deepEqual(fs.readdirSync(dir).filter((f) => f === 'stale.bin'), []);
  const r = openIndex(dir);
  assert.equal(r.docCount, 1);
  assert.equal(r.meta.skipped, 2);
  assert.deepEqual(r.postings('fish'), []);
});

test('an empty corpus is a legal index, not a crash', () => {
  const r = persisted([], { docs: 0, skipped: 3 });
  assert.equal(r.docCount, 0);
  assert.deepEqual(r.postings('anything'), []);
  assert.equal(r.meta.skipped, 3);
});

test('opening a missing index throws an Error naming the directory', () => {
  const dir = freshDir();
  assert.throws(() => openIndex(dir), (e) => e instanceof Error && e.message.includes(dir));
});

test('opening a corrupt index throws about the format, never returns garbage', () => {
  const dir = freshDir();
  writeIndex(dir, buildIndex(DOCS, { docs: 3, skipped: 0 }));
  const file = fs.readdirSync(dir).map((f) => path.join(dir, f)).sort((a, b) => fs.statSync(b).size - fs.statSync(a).size)[0];
  const buf = fs.readFileSync(file);
  buf.write('XXXX', 0);
  fs.writeFileSync(file, buf);
  assert.throws(() => openIndex(dir), (e) => e instanceof Error && /format|magic|version|corrupt/i.test(e.message));
});

test('the index of the development corpus is far smaller than the corpus', () => {
  const corpusFile = path.join(projectRoot, 'sample-docs.jsonl');
  const { docs, skipped } = readCorpus(corpusFile);
  const dir = freshDir();
  writeIndex(dir, buildIndex(docs, { docs: docs.length, skipped }));
  const ratio = bytesUnder(dir) / fs.statSync(corpusFile).size;
  assert.ok(ratio < 0.6, `index/corpus size ratio ${ratio.toFixed(3)} — the binary format is not doing its job`);

  const r = openIndex(dir);
  assert.equal(r.docCount, 120);
  assert.equal(r.meta.skipped, 5);
  const p = r.postings('wadiki');
  assert.ok(p.length > 0 && p.every((x) => Number.isInteger(x.doc) && x.doc < 120));
  assert.deepEqual(p.map((x) => r.docId(x.doc)).sort(), ['doc-0-0', 'doc-0-1', 'doc-0-2']);
});
