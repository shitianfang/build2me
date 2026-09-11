// The completion criterion for the whole system. It runs only when every
// child contract has been ACCEPTED in the same verification pass, so it must
// use STRUCTURAL status: querying accurate status from inside a completion
// gate re-enters this gate.
//
// The frontier check alone is NOT a completion criterion: at the moment of
// cascade it is true by construction and certifies nothing. Everything after
// it drives the FINISHED system the way the judge does — spawn search.mjs in
// a throwaway working directory, index, query, read stats — and checks the
// four judged dimensions end to end. The laws in laws/ hold the exact levels;
// this gate proves the composition works at all.
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
const work = fs.mkdtempSync(path.join(scratch, 'root-gate-'));
const run = (...args) => spawnSync(process.execPath, [CLI, ...args], { cwd: work, encoding: 'utf8', timeout: 120000 });
const lines = (s) => s.split('\n').filter((l) => l !== '');

test('the frontier is empty', () => {
  const r = spawnSync('node', [path.join(projectRoot, 'tools', 'frontier.mjs'), '--dir', projectRoot, '--json', '--structural'],
    { encoding: 'utf8', timeout: 60000 });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const open = JSON.parse(r.stdout).open.map((c) => c.name);
  assert.deepEqual(open, [], `still open: ${open.join(', ')}`);
});

test('the composed system answers as one', (t) => {
  // 1. Indexing the flawed development corpus succeeds and counts exactly.
  const indexed = run('index', SAMPLE);
  assert.equal(indexed.status, 0, `index failed: ${indexed.stderr}`);
  const stats = JSON.parse(run('stats').stdout);
  assert.deepEqual({ docs: stats.docs, skipped: stats.skipped }, { docs: 120, skipped: 5 },
    'the corpus holds 120 well-formed documents and 5 malformed lines');
  assert.ok(stats.indexBytes > 0);

  // 2. Size: the index is a fraction of the corpus it describes.
  const ratio = stats.indexBytes / fs.statSync(SAMPLE).size;
  assert.ok(ratio < 0.5, `index/corpus ratio ${ratio.toFixed(3)}`);

  // 3. Relevance, through the CLI, against the labelled bench set: every
  //    query's relevant documents should come back inside the ten printed ids.
  const { queries } = JSON.parse(fs.readFileSync(path.join(projectRoot, 'bench', 'queries.json'), 'utf8'));
  // Stride 7 is coprime with the five query kinds the bench emits per topic,
  // so the sample keeps hitting every kind — stride 5 would only ever pick the
  // easiest one and certify nothing.
  const sample = queries.filter((_, i) => i % 7 === 0);
  assert.ok(sample.length >= 20, 'the bench query set is missing or too small');
  const timings = [];
  let recall = 0;
  for (const q of sample) {
    const started = process.hrtime.bigint();
    const r = run('query', q.q);
    timings.push(Number(process.hrtime.bigint() - started) / 1e6);
    assert.equal(r.status, 0, `query "${q.q}" failed: ${r.stderr}`);
    const got = lines(r.stdout);
    assert.ok(got.length <= 10, `query "${q.q}" printed ${got.length} ids`);
    assert.equal(new Set(got).size, got.length, `query "${q.q}" repeated an id`);
    recall += got.filter((id) => q.relevant.includes(id)).length / q.relevant.length;
  }
  const meanRecall = recall / sample.length;
  assert.ok(meanRecall >= 0.75, `mean recall@10 ${meanRecall.toFixed(3)} over ${sample.length} labelled queries`);

  // 4. Speed: a query is one short-lived process, dominated by node's own start-up.
  timings.sort((a, b) => a - b);
  const p95 = timings[Math.max(0, Math.ceil(timings.length * 0.95) - 1)];
  assert.ok(p95 < 400, `p95 query latency ${p95.toFixed(1)} ms`);
  t.diagnostic(`docs=${stats.docs} skipped=${stats.skipped} ratio=${ratio.toFixed(3)} recall@10=${meanRecall.toFixed(3)} p95=${p95.toFixed(1)}ms`);

  // 5. The same query twice is the same answer.
  assert.equal(run('query', sample[0].q).stdout, run('query', sample[0].q).stdout);

  // 6. Re-indexing replaces the corpus entirely, and errors stay loud.
  const tiny = path.join(work, 'tiny.jsonl');
  fs.writeFileSync(tiny, `${JSON.stringify({ id: 'solo', title: 'solitary', body: 'a single document' })}\n`);
  assert.equal(run('index', tiny).status, 0);
  assert.deepEqual(lines(run('query', 'solitary').stdout), ['solo']);
  assert.deepEqual(lines(run('query', sample[0].q).stdout), [], 'the previous corpus is still searchable');
  const broken = run('index', path.join(work, 'absent.jsonl'));
  assert.equal(broken.status, 1);
  assert.equal(broken.stdout, '');
  assert.ok(broken.stderr.includes('absent.jsonl'));
  assert.equal(JSON.parse(run('stats').stdout).docs, 1, 'a failed index destroyed the working index');
});

test.after(() => fs.rmSync(work, { recursive: true, force: true }));
