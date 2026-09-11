// Gate for contract "text-analyzer".
// One tokenizer, used by both sides of the engine. The last test enforces
// that literally: no other source file may carry a token regex of its own,
// because a second analyzer silently breaks index/query vocabulary agreement.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tokenize } from '../lib/analyze.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('lowercases and keeps alphanumeric runs, dropping every separator', () => {
  assert.deepEqual(tokenize('Hello, WORLD!'), ['hello', 'world']);
  assert.deepEqual(tokenize('a-b_c.d/e'), ['a', 'b', 'c', 'd', 'e']);
  assert.deepEqual(tokenize('  spaced\tout\nlines  '), ['spaced', 'out', 'lines']);
});

test('digits are terms and join letters inside a run', () => {
  assert.deepEqual(tokenize('abc123 45 x9y'), ['abc123', '45', 'x9y']);
});

test('diacritics fold, so Cafe and Café produce the same token', () => {
  assert.deepEqual(tokenize('Café'), ['cafe']);
  assert.deepEqual(tokenize('Café'), tokenize('cafe'));
  assert.deepEqual(tokenize('naïve RÉSUMÉ'), ['naive', 'resume']);
});

test('empty and term-free input yield an empty array, never an empty token', () => {
  assert.deepEqual(tokenize(''), []);
  assert.deepEqual(tokenize('   '), []);
  assert.deepEqual(tokenize('--- !!! ???'), []);
  assert.deepEqual(tokenize(null), []);
  assert.deepEqual(tokenize(undefined), []);
  assert.deepEqual(tokenize(42), []);
});

test('deterministic and idempotent', () => {
  const text = 'The Quick, brown FOX -- jumps over 2 lazy dogs; Café!';
  const once = tokenize(text);
  assert.deepEqual(tokenize(text), once);
  assert.deepEqual(tokenize(once.join(' ')), once);
  assert.ok(once.every((t) => t.length > 0 && /^[a-z0-9]+$/.test(t)));
});

test('a realistic document tokenizes into the terms a query would produce', () => {
  const body = 'baribri vekive watugu feriso riguwa';
  assert.deepEqual(tokenize(body), ['baribri', 'vekive', 'watugu', 'feriso', 'riguwa']);
  assert.deepEqual(tokenize('  BARIBRI,  Riguwa!  '), ['baribri', 'riguwa']);
});

test('it is the only tokenizer: no other source file declares a token character class', () => {
  const sources = [path.join(projectRoot, 'search.mjs'), ...fs.readdirSync(path.join(projectRoot, 'lib')).map((f) => path.join(projectRoot, 'lib', f))];
  const offenders = sources.filter((f) => path.basename(f) !== 'analyze.mjs' && fs.readFileSync(f, 'utf8').includes('a-z0-9'));
  assert.deepEqual(offenders.map((f) => path.relative(projectRoot, f)), [], 'these files tokenize on their own instead of importing lib/analyze.mjs');
});
