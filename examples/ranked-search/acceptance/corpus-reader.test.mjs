// Gate for contract "corpus-reader".
// The robustness dimension lives here: a corpus full of garbage must still
// yield every usable document and an EXACT count of what was thrown away,
// because the judge compares that number against its own generator.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readCorpus } from '../lib/corpus.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-corpus-'));
const corpus = (name, text) => {
  const p = path.join(tmp, name);
  fs.writeFileSync(p, text);
  return p;
};
const doc = (id, title, body) => JSON.stringify({ id, title, body });

test('valid lines become documents, in file order, with only the three fields', () => {
  const file = corpus('ok.jsonl', [doc('a', 'T a', 'B a'), doc('b', 'T b', 'B b'), doc('c', 'T c', 'B c')].join('\n') + '\n');
  const { docs, skipped } = readCorpus(file);
  assert.equal(skipped, 0);
  assert.deepEqual(docs.map((d) => d.id), ['a', 'b', 'c']);
  assert.deepEqual(docs[0], { id: 'a', title: 'T a', body: 'B a' });
  assert.deepEqual(Object.keys(docs[1]).sort(), ['body', 'id', 'title']);
});

test('extra JSON fields are ignored, not carried into the document', () => {
  const file = corpus('extra.jsonl', '{"id":"a","title":"t","body":"b","score":9,"tags":["x"]}\n');
  const { docs, skipped } = readCorpus(file);
  assert.equal(skipped, 0);
  assert.deepEqual(docs, [{ id: 'a', title: 't', body: 'b' }]);
});

test('every kind of malformed line is skipped and counted, and reading still succeeds', () => {
  const lines = [
    doc('good-1', 't', 'b'),
    '{"id":"trunc","title":"t","body":',        // truncated JSON
    'not json at all',                           // not JSON
    '{"id":"nofields"}',                         // missing title and body
    '{"title":"t","body":"b"}',                  // missing id
    '{"id":"a","title":null,"body":"b"}',        // null field
    '{"id":"a","title":"t","body":42}',          // non-string field
    '[1,2,3]',                                   // JSON, but an array
    '"a string"',                                // JSON, but not an object
    '42',                                        // JSON, but not an object
    'null',                                      // JSON null
    doc('good-2', 't', 'b'),
  ];
  const file = corpus('flawed.jsonl', lines.join('\n') + '\n');
  const { docs, skipped } = readCorpus(file);
  assert.deepEqual(docs.map((d) => d.id), ['good-1', 'good-2']);
  assert.equal(skipped, 10);
});

test('blank and whitespace-only lines are file whitespace: neither documents nor skips', () => {
  const file = corpus('blanks.jsonl', ['', doc('a', 't', 'b'), '', '   ', '\t', doc('b', 't', 'b'), '', ''].join('\n'));
  const { docs, skipped } = readCorpus(file);
  assert.deepEqual(docs.map((d) => d.id), ['a', 'b']);
  assert.equal(skipped, 0);
});

test('a file with no trailing newline loses nothing', () => {
  const file = corpus('nonl.jsonl', [doc('a', 't', 'b'), doc('b', 't', 'b')].join('\n'));
  assert.deepEqual(readCorpus(file).docs.map((d) => d.id), ['a', 'b']);
});

test('CRLF line endings parse identically to LF', () => {
  const lines = [doc('a', 't', 'b'), 'garbage', doc('b', 't', 'b')];
  const lf = readCorpus(corpus('lf.jsonl', lines.join('\n') + '\n'));
  const crlf = readCorpus(corpus('crlf.jsonl', lines.join('\r\n') + '\r\n'));
  assert.deepEqual(crlf, lf);
});

test('documents far larger than one read chunk survive the streaming reader', () => {
  const big = 'lorem '.repeat(60000).trim();   // ~360 KB on one line
  const file = corpus('big.jsonl', [doc('small', 't', 'b'), doc('big', 'big title', big), doc('after', 't', 'b')].join('\n') + '\n');
  const { docs, skipped } = readCorpus(file);
  assert.equal(skipped, 0);
  assert.deepEqual(docs.map((d) => d.id), ['small', 'big', 'after']);
  assert.equal(docs[1].body.length, big.length);
});

test('the development corpus sample-docs.jsonl: 120 documents, exactly 5 skipped', () => {
  const { docs, skipped } = readCorpus(path.join(projectRoot, 'sample-docs.jsonl'));
  assert.equal(docs.length, 120);
  assert.equal(skipped, 5);
  assert.equal(docs[0].id, 'doc-13-0');
  assert.ok(docs.every((d) => typeof d.id === 'string' && typeof d.title === 'string' && typeof d.body === 'string'));
});

test('an unreadable path throws an Error naming the path', () => {
  const missing = path.join(tmp, 'does-not-exist.jsonl');
  assert.throws(() => readCorpus(missing), (e) => e instanceof Error && e.message.includes(missing));
});
