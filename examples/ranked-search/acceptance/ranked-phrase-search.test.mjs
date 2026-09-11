// The completion criterion for the whole system, round 2: everything the
// deprecated ranked-search gate proved (it runs alongside this file, so the
// frontier check, the four original dimensions and the re-index behaviour are
// all still enforced) plus the dimension exact-phrase search added.
//
// It drives the FINISHED system the way the judge does — spawn search.mjs in a
// throwaway working directory — and it judges the answers against the labelled
// phrase sets in bench/queries.json, whose ground truth is a brute-force
// adjacency scan of the corpus that knows nothing about the index. A third of
// those queries are phrases the corpus does NOT contain: printing nothing is
// the right answer, and a filter that never filters fails them.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(projectRoot, 'search.mjs');
const SAMPLE = path.join(projectRoot, 'sample-docs.jsonl');
const scratch = path.join(projectRoot, '.tmp');
fs.mkdirSync(scratch, { recursive: true });
const work = fs.mkdtempSync(path.join(scratch, 'phrase-gate-'));
const run = (...args) => spawnSync(process.execPath, [CLI, ...args], { cwd: work, encoding: 'utf8', timeout: 120000 });
const lines = (s) => s.split('\n').filter((l) => l !== '');

const { queries, phraseQueries } = JSON.parse(fs.readFileSync(path.join(projectRoot, 'bench', 'queries.json'), 'utf8'));

test('the composed system answers quoted queries exactly', (t) => {
  assert.equal(run('index', SAMPLE).status, 0);
  assert.ok(Array.isArray(phraseQueries) && phraseQueries.length > 100,
    'bench/queries.json must carry the labelled phrase set (node bench/make-queries.mjs)');

  // Stride 13 is coprime with the five phrase kinds the generator emits per
  // document, so the sample keeps hitting all of them — matching and empty.
  const sample = phraseQueries.filter((_, i) => i % 13 === 0);
  let matching = 0;
  let empty = 0;
  for (const q of sample) {
    const r = run('query', q.q);
    assert.equal(r.status, 0, `query ${q.q} failed: ${r.stderr}`);
    const got = lines(r.stdout);
    assert.ok(got.length <= 10, `query ${q.q} printed ${got.length} ids`);
    assert.equal(new Set(got).size, got.length, `query ${q.q} repeated an id`);
    assert.deepEqual([...got].sort(), [...q.relevant].sort(),
      `query ${q.q} must return exactly the documents holding the phrase`);
    if (q.relevant.length === 0) empty++; else matching++;
  }
  assert.ok(matching >= 10 && empty >= 10,
    `the sample must exercise both outcomes (${matching} matching, ${empty} empty)`);
  t.diagnostic(`${sample.length} phrase queries through the CLI: ${matching} matching, ${empty} correctly empty`);
});

test('a phrase narrows an ordinary query without re-sorting it', () => {
  assert.equal(run('index', SAMPLE).status, 0);
  const q = phraseQueries.find((x) => x.relevant.length >= 2 && x.phrase.length >= 2);
  assert.ok(q, 'no multi-document phrase in the bench set');
  const quoted = lines(run('query', q.q).stdout);
  const loose = lines(run('query', q.phrase.join(' ')).stdout);
  assert.deepEqual([...quoted].sort(), [...q.relevant].sort());
  assert.deepEqual(quoted.filter((id) => loose.includes(id)), loose.filter((id) => quoted.includes(id)),
    'the documents the two answers share must appear in the same order');
  // The same words unquoted are a plain term query: it may answer more widely.
  assert.ok(loose.length >= quoted.length);
});

test('quoting did not disturb the unquoted system', () => {
  assert.equal(run('index', SAMPLE).status, 0);
  const sample = queries.filter((_, i) => i % 17 === 0);
  let recall = 0;
  for (const q of sample) {
    const got = lines(run('query', q.q).stdout);
    assert.ok(got.length > 0 && got.length <= 10, `query "${q.q}" printed ${got.length} ids`);
    recall += got.filter((id) => q.relevant.includes(id)).length / q.relevant.length;
  }
  assert.ok(recall / sample.length >= 0.75, `mean recall@10 ${(recall / sample.length).toFixed(3)}`);
  const stats = JSON.parse(run('stats').stdout);
  assert.deepEqual({ docs: stats.docs, skipped: stats.skipped }, { docs: 120, skipped: 5 });
});

test('phrases follow the index, not the process: re-indexing replaces them', () => {
  assert.equal(run('index', SAMPLE).status, 0);
  const q = phraseQueries.find((x) => x.relevant.length > 0);
  assert.ok(lines(run('query', q.q).stdout).length > 0);

  const tiny = path.join(work, 'tiny.jsonl');
  fs.writeFileSync(tiny, `${[
    { id: 'solo', title: 'solitary heading', body: 'a single document with a repeated phrase, a repeated phrase' },
    { id: 'other', title: 'nothing', body: 'phrase repeated a single' },
  ].map((d) => JSON.stringify(d)).join('\n')}\n`);
  assert.equal(run('index', tiny).status, 0);
  assert.deepEqual(lines(run('query', q.q).stdout), [], 'the previous corpus is still searchable by phrase');
  assert.deepEqual(lines(run('query', '"repeated phrase"').stdout), ['solo']);
  assert.deepEqual(lines(run('query', '"solitary heading"').stdout), ['solo']);
  assert.deepEqual(lines(run('query', '"heading a"').stdout), [], 'a phrase may not cross from title to body');
  assert.deepEqual(lines(run('query', '"a single"').stdout).sort(), ['other', 'solo']);
  assert.equal(JSON.parse(run('stats').stdout).docs, 2);
});

test.after(() => fs.rmSync(work, { recursive: true, force: true }));
