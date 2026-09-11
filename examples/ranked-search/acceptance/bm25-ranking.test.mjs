// Gate for contract "bm25-ranking".
// Pure scoring, exercised against a hand-built reader that implements the
// inverted-index reader interface — no files, no CLI. Each test pins one
// property the hidden P@10 judge depends on: rare terms beat common ones,
// covering ALL query terms beats hammering one of them, titles beat bodies,
// padded documents do not win by bulk, and output is deterministic.
import test from 'node:test';
import assert from 'node:assert/strict';
import { rank } from '../lib/rank.mjs';

// docs: [{ id, title: [terms], body: [terms] }] — a title occurrence counts
// double toward document length, exactly as the persisted index records it.
function makeReader(docs) {
  const count = (list, t) => list.filter((x) => x === t).length;
  const lens = docs.map((d) => d.title.length * 2 + d.body.length);
  return {
    docCount: docs.length,
    avgDocLen: lens.reduce((a, b) => a + b, 0) / Math.max(1, docs.length),
    meta: {},
    docId: (i) => docs[i].id,
    docLen: (i) => lens[i],
    postings: (term) => docs
      .map((d, i) => ({ doc: i, body: count(d.body, term), title: count(d.title, term) }))
      .filter((p) => p.body > 0 || p.title > 0),
  };
}
const filler = (n, prefix = 'f') => Array.from({ length: n }, (_, i) => `${prefix}${i}`);

test('a rare term outranks a common one: only the rare match comes back', () => {
  const docs = [
    { id: 'd1', title: [], body: ['rare', 'common', ...filler(20)] },
    ...[2, 3, 4, 5].map((n) => ({ id: `d${n}`, title: [], body: ['common', ...filler(21)] })),
  ];
  const r = makeReader(docs);
  assert.deepEqual(rank(r, ['rare'], 10), ['d1']);
  assert.equal(rank(r, ['common'], 10).length, 5);
  assert.equal(rank(r, ['common', 'rare'], 10)[0], 'd1');
});

test('covering every query term beats piling up one of them', () => {
  // Tuned to be decided BY the coverage factor: "beta" is rare (df 2) and
  // "alpha" middling (df 24), so on the raw BM25 sum the document that repeats
  // beta three times outscores the one that has both terms once. Only ranking
  // by how well a document matches ALL the query's terms puts them back in the
  // right order — drop that factor and this assertion flips.
  const docs = [
    { id: 'covers-both', title: [], body: ['alpha', 'beta', ...filler(28)] },
    { id: 'hammers-one', title: [], body: ['beta', 'beta', 'beta', ...filler(27)] },
  ];
  for (let i = 0; i < 98; i++) {
    const body = filler(30);
    if (i < 23) body[0] = 'alpha';
    docs.push({ id: `pad${String(i).padStart(2, '0')}`, title: [], body });
  }
  const r = makeReader(docs);
  assert.equal(r.postings('alpha').length, 24);
  assert.equal(r.postings('beta').length, 2);
  const out = rank(r, ['alpha', 'beta'], 10);
  assert.equal(out[0], 'covers-both', `the partial match won: ${out.slice(0, 3).join(', ')}`);
  assert.equal(out[1], 'hammers-one');
});

test('between two partial matches, the one holding the rarer term wins', () => {
  // Neither document covers the whole query and both match exactly one term,
  // so coverage cannot decide this: only idf can. The document with the rare
  // term is deliberately the one that LOSES an alphabetical tie-break, so a
  // scorer that treats all terms alike fails here instead of passing by luck.
  const docs = [
    { id: 'aaa-has-the-common-term', title: [], body: ['common', ...filler(20)] },
    { id: 'zzz-has-the-rare-term', title: [], body: ['rare', ...filler(20)] },
  ];
  for (let i = 0; i < 40; i++) docs.push({ id: `c${String(i).padStart(2, '0')}`, title: [], body: [i < 30 ? 'common' : 'x', ...filler(20)] });
  const r = makeReader(docs);
  assert.equal(r.postings('common').length, 31);
  assert.equal(r.postings('rare').length, 1);
  const out = rank(r, ['rare', 'common'], 10);
  assert.equal(out[0], 'zzz-has-the-rare-term', `rare term did not win: ${out.slice(0, 3).join(', ')}`);
  assert.equal(out[1], 'aaa-has-the-common-term');
});

test('a title hit outranks the same term buried in the body', () => {
  const docs = [
    { id: 'in-title', title: ['needle'], body: filler(20) },
    { id: 'in-body', title: ['plain'], body: ['needle', ...filler(19)] },
  ];
  assert.deepEqual(rank(makeReader(docs), ['needle'], 10), ['in-title', 'in-body']);
});

test('length normalisation: the same evidence in a shorter document wins', () => {
  const docs = [
    { id: 'short', title: [], body: ['needle', ...filler(10)] },
    { id: 'padded', title: [], body: ['needle', ...filler(400)] },
  ];
  assert.deepEqual(rank(makeReader(docs), ['needle'], 10), ['short', 'padded']);
});

test('query terms unknown to the index are ignored, not disqualifying', () => {
  const docs = [
    { id: 'd1', title: [], body: ['rare', ...filler(20)] },
    { id: 'd2', title: [], body: filler(21) },
  ];
  assert.deepEqual(rank(makeReader(docs), ['rare', 'thistermdoesnotexist'], 10), ['d1']);
  assert.deepEqual(rank(makeReader(docs), ['thistermdoesnotexist'], 10), []);
});

test('only documents scoring above zero are returned, and never more than the limit', () => {
  const docs = filler(12, 'd').map((id) => ({ id, title: [], body: ['hit', ...filler(10)] }));
  docs.push({ id: 'miss', title: [], body: filler(11) });
  const r = makeReader(docs);
  assert.equal(rank(r, ['hit'], 5).length, 5);
  assert.equal(rank(r, ['hit'], 10).length, 10);
  assert.equal(rank(r, ['hit'], 100).length, 12);
  assert.ok(!rank(r, ['hit'], 100).includes('miss'));
  assert.deepEqual(rank(r, [], 10), []);
  assert.deepEqual(rank(makeReader([]), ['hit'], 10), []);
});

test('ties break deterministically by ascending id', () => {
  const body = ['needle', ...filler(10)];
  const r = makeReader([{ id: 'zzz', title: [], body }, { id: 'aaa', title: [], body }, { id: 'mmm', title: [], body }]);
  assert.deepEqual(rank(r, ['needle'], 10), ['aaa', 'mmm', 'zzz']);
  assert.deepEqual(rank(r, ['needle'], 10), rank(r, ['needle'], 10));
});

test('a repeated query term does not multiply a document past its evidence', () => {
  const docs = [
    { id: 'one', title: [], body: ['alpha', 'beta', ...filler(20)] },
    { id: 'two', title: [], body: ['alpha', 'alpha', ...filler(20)] },
  ];
  const r = makeReader(docs);
  assert.deepEqual(rank(r, ['alpha', 'alpha'], 10), rank(r, ['alpha'], 10));
  assert.equal(rank(r, ['alpha', 'beta'], 10)[0], 'one');
});

test('a duplicated document id is printed once', () => {
  const body = ['needle', ...filler(10)];
  const r = makeReader([{ id: 'dup', title: [], body }, { id: 'dup', title: [], body }, { id: 'other', title: [], body }]);
  const out = rank(r, ['needle'], 10);
  assert.deepEqual(out, ['dup', 'other']);
});
