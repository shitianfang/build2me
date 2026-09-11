// Gate for contract "positional-index" — the half of the statement the
// deprecated inverted-index gate does not cover: WHERE each term occurs.
// (The contract's acceptance runs that older gate alongside this one, so the
// frequency behaviour it pins keeps being enforced.)
//
// Positions are the only reason this format exists, so the tests are about the
// properties phrase-matching depends on: positions round-trip exactly, tf is
// the number of them, the title/body split is readable off them, and the field
// boundary is a real gap no adjacency can cross.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildIndex, writeIndex, openIndex, bodyPosition } from '../lib/index-format.mjs';
import { readCorpus } from '../lib/corpus.mjs';
import { tokenize } from '../lib/analyze.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-positions-'));
let seq = 0;
const freshDir = () => path.join(tmp, `idx-${seq++}`);
const persisted = (docs, meta = { docs: docs.length, skipped: 0 }) => {
  const dir = freshDir();
  writeIndex(dir, buildIndex(docs, meta));
  return openIndex(dir);
};

const DOCS = [
  { id: 'alpha', title: 'red fish', body: 'the red fish swims and the fish swims again' },
  { id: 'beta', title: 'blue sky', body: 'red sky at night, fish red' },
  { id: 'gamma', title: '', body: 'fish red' },
];

test('postings carry every occurrence, ascending, and tf is how many there are', () => {
  const r = persisted(DOCS);
  const fish = r.postings('fish');
  assert.deepEqual(fish.map((p) => p.doc), [0, 1, 2]);
  for (const p of fish) {
    assert.equal(p.positions.length, p.body + p.title, 'tf must equal the number of positions');
    assert.deepEqual([...p.positions].sort((a, b) => a - b), p.positions, 'positions must ascend');
    assert.equal(new Set(p.positions).size, p.positions.length, 'a position may not repeat');
  }
  // alpha: title "red fish" -> fish at 1; body "the red fish swims and the fish
  // swims again" -> tokens 0..8 offset by titleLen + 1 = 3, so fish at 3+2 and 3+6.
  assert.deepEqual(r.postings('fish')[0].positions, [1, bodyPosition(2, 2), bodyPosition(2, 6)]);
  assert.equal(fish[0].title, 1);
  assert.equal(fish[0].body, 2);
});

test('the title/body split is read off the positions', () => {
  const r = persisted(DOCS);
  const red = r.postings('red');
  assert.deepEqual(red.map((p) => [p.doc, p.title, p.body]), [[0, 1, 1], [1, 0, 2], [2, 0, 1]]);
  assert.equal(r.docTitleLen(0), 2);
  assert.equal(r.docTitleLen(2), 0, 'a document with an empty title has no title tokens');
  for (const p of red) {
    const titleLen = r.docTitleLen(p.doc);
    assert.equal(p.positions.filter((x) => x < titleLen).length, p.title);
    assert.equal(p.positions.filter((x) => x > titleLen).length, p.body);
  }
});

test('the field boundary is a gap: no title token is adjacent to a body token', () => {
  // The title ENDS with "start" and the body BEGINS with "start": if the two
  // fields shared one coordinate line, the phrase "start start" would match a
  // document that never contains it.
  const r = persisted([{ id: 'd', title: 'end start', body: 'start end' }]);
  const titleLen = r.docTitleLen(0);
  assert.equal(titleLen, 2);
  const start = r.postings('start')[0];
  const end = r.postings('end')[0];
  assert.deepEqual(start.positions, [1, bodyPosition(titleLen, 0)]);
  assert.deepEqual(end.positions, [0, bodyPosition(titleLen, 1)]);
  assert.equal(bodyPosition(titleLen, 0) - (titleLen - 1), 2,
    'the last title position and the first body position must be two apart, not adjacent');
  assert.ok(!start.positions.some((p) => start.positions.includes(p + 1)),
    'a phrase could straddle the title/body boundary');
});

test('positions round-trip exactly over the whole development corpus', () => {
  const { docs } = readCorpus(path.join(projectRoot, 'sample-docs.jsonl'));
  const r = persisted(docs, { docs: docs.length, skipped: 5 });
  // Rebuild the truth independently, straight from the tokenizer.
  const truth = new Map();   // term -> Map(docIndex -> positions)
  docs.forEach((d, i) => {
    const title = tokenize(d.title);
    const body = tokenize(d.body);
    const put = (term, at) => {
      if (!truth.has(term)) truth.set(term, new Map());
      const perDoc = truth.get(term);
      if (!perDoc.has(i)) perDoc.set(i, []);
      perDoc.get(i).push(at);
    };
    title.forEach((t, j) => put(t, j));
    body.forEach((t, j) => put(t, bodyPosition(title.length, j)));
  });
  assert.ok(truth.size > 100, 'the development corpus should hold hundreds of terms');
  let occurrences = 0;
  for (const [term, perDoc] of truth) {
    const got = r.postings(term);
    assert.equal(got.length, perDoc.size, `df mismatch for "${term}"`);
    for (const p of got) {
      assert.deepEqual(p.positions, perDoc.get(p.doc), `positions mismatch for "${term}" in document ${p.doc}`);
      occurrences += p.positions.length;
    }
  }
  assert.ok(occurrences > 10000, `only ${occurrences} occurrences recorded`);
});

test('an index written by another format version is refused, never misread', () => {
  const dir = freshDir();
  writeIndex(dir, buildIndex(DOCS, { docs: 3, skipped: 0 }));
  const file = path.join(dir, fs.readdirSync(dir)[0]);
  const buf = fs.readFileSync(file);
  buf.writeUInt8(buf.readUInt8(4) - 1, 4);        // an older version's byte
  fs.writeFileSync(file, buf);
  assert.throws(() => openIndex(dir), (e) => e instanceof Error && /version/i.test(e.message));
});

test('positions survive the shapes that break naive encoders', () => {
  const long = Array.from({ length: 300 }, (_, i) => `w${i}`);      // positions past one varint byte
  const docs = [
    { id: 'repeat', title: 'x x x', body: 'x x' },                  // same term, many positions
    { id: 'far', title: 'head', body: `${long.join(' ')} tail` },
    { id: 'emptybody', title: 'only a title', body: '' },
    { id: 'empty', title: '', body: '' },
  ];
  const r = persisted(docs);
  assert.deepEqual(r.postings('x')[0].positions, [0, 1, 2, bodyPosition(3, 0), bodyPosition(3, 1)]);
  const tail = r.postings('tail')[0];
  assert.deepEqual(tail.positions, [bodyPosition(1, 300)]);
  assert.ok(tail.positions[0] > 127, 'the interesting case is a position that needs two varint bytes');
  assert.equal(r.postings('w299')[0].positions[0], bodyPosition(1, 299));
  assert.deepEqual(r.postings('title').map((p) => p.doc), [2]);
  assert.equal(r.docTitleLen(3), 0);
  assert.equal(r.docLen(3), 0);
});
