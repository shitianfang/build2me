// Gate for contract "phrase-matching".
// Two halves, tested apart: reading phrases out of a raw query string, and
// deciding which documents hold one. The matcher is pure, so most of it runs
// against a hand-built reader whose positions are written out by hand — if the
// semantics only held for indexes this project happens to produce, they would
// not be semantics. The last test closes the loop against the real index and
// the real corpus, with a brute-force scan as the oracle.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { quotedPhrases, phraseDocs, phraseDocIds } from '../lib/phrase.mjs';
import { buildIndex, writeIndex, openIndex, bodyPosition } from '../lib/index-format.mjs';
import { readCorpus } from '../lib/corpus.mjs';
import { tokenize } from '../lib/analyze.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// A reader built from explicit token streams: title tokens at 0.., body tokens
// at titleLen + 1.., exactly the position space the contract names.
function makeReader(docs) {
  const positions = docs.map((d) => {
    const at = new Map();
    const put = (t, p) => at.set(t, [...(at.get(t) ?? []), p]);
    d.title.forEach((t, j) => put(t, j));
    d.body.forEach((t, j) => put(t, bodyPosition(d.title.length, j)));
    return at;
  });
  return {
    docCount: docs.length,
    avgDocLen: 1,
    meta: {},
    docId: (i) => docs[i].id,
    docLen: (i) => docs[i].title.length * 5 + docs[i].body.length,
    docTitleLen: (i) => docs[i].title.length,
    postings: (term) => positions.flatMap((at, i) => {
      const p = at.get(term);
      if (!p) return [];
      const title = p.filter((x) => x < docs[i].title.length).length;
      return [{ doc: i, title, body: p.length - title, positions: p }];
    }),
  };
}

const READER = makeReader([
  { id: 'd0', title: ['alpha', 'beta'], body: ['alpha', 'beta', 'gamma', 'delta'] },
  { id: 'd1', title: ['gamma'], body: ['beta', 'alpha', 'gamma', 'alpha', 'beta'] },
  { id: 'd2', title: [], body: ['alpha', 'x', 'beta', 'gamma'] },
  { id: 'd3', title: ['beta'], body: ['alpha', 'beta', 'gamma'] },
  { id: 'd4', title: [], body: ['tick', 'tick', 'tick'] },
]);

test('quotedPhrases reads the closed quoted segments, tokenized, in order', () => {
  assert.deepEqual(quotedPhrases('"alpha beta gamma"'), [['alpha', 'beta', 'gamma']]);
  assert.deepEqual(quotedPhrases('loose "alpha beta" more "gamma delta" tail'),
    [['alpha', 'beta'], ['gamma', 'delta']]);
  assert.deepEqual(quotedPhrases('"Café Crème!"'), [['cafe', 'creme']], 'phrases go through the shared analyzer');
  assert.deepEqual(quotedPhrases('"alpha"'), [['alpha']]);
});

test('quotedPhrases refuses to invent a phrase', () => {
  assert.deepEqual(quotedPhrases('alpha beta'), [], 'an unquoted query has no phrases');
  assert.deepEqual(quotedPhrases('"alpha beta'), [], 'an unterminated quote is not a phrase');
  assert.deepEqual(quotedPhrases('"a b" and "dangling'), [['a', 'b']], 'the closed one still counts');
  assert.deepEqual(quotedPhrases('""'), [], 'an empty phrase is dropped, not made unsatisfiable');
  assert.deepEqual(quotedPhrases('" - "'), []);
  assert.deepEqual(quotedPhrases(''), []);
  assert.deepEqual(quotedPhrases(undefined), []);
});

test('a phrase matches only where the words are adjacent and in order', () => {
  // d0 holds "alpha beta" in both fields, d1 in its body only, d2 has a word
  // between them, d3 has them adjacent in the body.
  assert.deepEqual(phraseDocs(READER, ['alpha', 'beta']), [0, 1, 3]);
  assert.deepEqual(phraseDocs(READER, ['beta', 'alpha']), [1], 'order is part of the phrase');
  assert.deepEqual(phraseDocs(READER, ['alpha', 'x', 'beta']), [2]);
  assert.deepEqual(phraseDocs(READER, ['alpha', 'beta', 'gamma']), [0, 3]);
  assert.deepEqual(phraseDocs(READER, ['gamma', 'beta']), [], 'no document holds that pair adjacent');
  assert.deepEqual(phraseDocs(READER, ['alpha', 'gamma']), [1], 'but that one does, in d1\'s body');
});

test('a phrase may not straddle the title and the body', () => {
  // d3's title is ["beta"] and its body starts with "alpha": "beta alpha" is
  // adjacent in d1's body only, never across d3's field boundary.
  assert.deepEqual(phraseDocs(READER, ['beta', 'alpha']), [1]);
  const r = makeReader([{ id: 'only', title: ['end'], body: ['start'] }]);
  assert.deepEqual(phraseDocs(r, ['end', 'start']), [], 'title-end + body-start is not a phrase');
  assert.deepEqual(phraseDocs(r, ['end']), [0]);
  assert.deepEqual(phraseDocs(r, ['start']), [0]);
});

test('degenerate phrases behave, and repeats are counted properly', () => {
  assert.deepEqual(phraseDocs(READER, ['alpha']), [0, 1, 2, 3], 'a one-word phrase is the term itself');
  assert.deepEqual(phraseDocs(READER, ['tick', 'tick']), [4]);
  assert.deepEqual(phraseDocs(READER, ['tick', 'tick', 'tick']), [4]);
  assert.deepEqual(phraseDocs(READER, ['tick', 'tick', 'tick', 'tick']), [], 'three ticks are not four');
  assert.deepEqual(phraseDocs(READER, []), []);
  assert.deepEqual(phraseDocs(READER, ['alpha', 'nosuchterm']), [], 'an unknown term matches nothing');
  assert.deepEqual(phraseDocs(makeReader([]), ['alpha']), []);
});

test('phraseDocIds separates "do not restrict" from "nothing can match"', () => {
  assert.equal(phraseDocIds(READER, []), null, 'no phrase means no restriction');
  assert.equal(phraseDocIds(READER, undefined), null);
  assert.deepEqual(phraseDocIds(READER, [['alpha', 'beta']]), new Set(['d0', 'd1', 'd3']));
  assert.deepEqual(phraseDocIds(READER, [['gamma', 'beta']]), new Set(), 'an impossible phrase is the empty set');
  assert.deepEqual(phraseDocIds(READER, [['alpha', 'beta'], ['beta', 'alpha']]), new Set(['d1']),
    'every phrase must match');
  assert.deepEqual(phraseDocIds(READER, [['alpha', 'beta'], ['tick', 'tick']]), new Set());
});

test('against the real index and the real corpus, a brute-force scan agrees exactly', () => {
  const corpusFile = path.join(projectRoot, 'sample-docs.jsonl');
  const { docs } = readCorpus(corpusFile);
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gate-phrase-')), 'index');
  writeIndex(dir, buildIndex(docs, { docs: docs.length, skipped: 0 }));
  const reader = openIndex(dir);

  const fields = docs.map((d) => ({ id: d.id, streams: [tokenize(d.title), tokenize(d.body)] }));
  const oracle = (phrase) => fields
    .filter((f) => f.streams.some((s) => s.some((_, i) => phrase.every((t, k) => s[i + k] === t))))
    .map((f) => f.id).sort();

  // Real phrases lifted out of the corpus, plus the same words reversed, plus
  // pairs that exist in a document but far apart: matches AND non-matches.
  const probes = [];
  fields.forEach((f, i) => {
    const [title, body] = f.streams;
    if (body.length >= 6) probes.push(body.slice(2, 5), [body[4], body[3]], [body[0], body[5]]);
    if (title.length >= 2) probes.push(title.slice(0, 2), [title.at(-1), body[0]]);
    if (i % 17 === 0 && body.length > 1) probes.push([body[0]]);
  });
  assert.ok(probes.length > 200, `only ${probes.length} probes`);

  let matched = 0;
  let empty = 0;
  for (const phrase of probes) {
    const want = oracle(phrase);
    const got = [...phraseDocIds(reader, [phrase])].sort();
    assert.deepEqual(got, want, `phrase "${phrase.join(' ')}"`);
    if (want.length > 0) matched++; else empty++;
  }
  assert.ok(matched > 100 && empty > 50, `probes must cover both outcomes (${matched} matched, ${empty} empty)`);
});
