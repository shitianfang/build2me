// Gate for contract "search-cli-phrases" — the quoting half of the CLI's
// statement. (Its acceptance runs the deprecated search-cli gate alongside
// this one, so the unquoted surface, the error paths and the stats shape are
// still enforced, by the same assertions that always enforced them.)
//
// Black-box throughout: spawn search.mjs the way a user — and the judge — does,
// in a throwaway working directory. The oracle for "is this answer right" is a
// brute-force scan of the corpus, never the implementation.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { readCorpus } from '../lib/corpus.mjs';
import { tokenize } from '../lib/analyze.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(projectRoot, 'search.mjs');
const SAMPLE = path.join(projectRoot, 'sample-docs.jsonl');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-cli-phrases-'));
let seq = 0;
const workdir = () => { const d = path.join(tmp, `w${seq++}`); fs.mkdirSync(d); return d; };
const run = (cwd, ...args) => spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8', timeout: 60000 });
const lines = (s) => s.split('\n').filter((l) => l !== '');
const indexed = (rows) => {
  const w = workdir();
  const file = path.join(w, 'corpus.jsonl');
  fs.writeFileSync(file, `${rows.map((r) => JSON.stringify(r)).join('\n')}\n`);
  assert.equal(run(w, 'index', file).status, 0);
  return w;
};

// One shared index of the development corpus, plus the brute-force oracle.
const sample = workdir();
assert.equal(run(sample, 'index', SAMPLE).status, 0);
const { docs } = readCorpus(SAMPLE);
const fields = docs.map((d) => ({ id: d.id, streams: [tokenize(d.title), tokenize(d.body)] }));
const oracle = (phrase) => fields
  .filter((f) => f.streams.some((s) => s.some((_, i) => phrase.every((t, k) => s[i + k] === t))))
  .map((f) => f.id);

test('a quoted query returns exactly the documents holding the phrase', () => {
  let checked = 0;
  for (const f of fields.filter((_, i) => i % 11 === 0)) {
    for (const phrase of [f.streams[1].slice(1, 4), f.streams[0].slice(0, 2)].filter((p) => p.length >= 2)) {
      const want = oracle(phrase);
      assert.ok(want.length > 0 && want.length <= 10, `unusable probe "${phrase.join(' ')}"`);
      const r = run(sample, 'query', `"${phrase.join(' ')}"`);
      assert.equal(r.status, 0, r.stderr);
      assert.deepEqual(lines(r.stdout).sort(), [...want].sort(), `phrase "${phrase.join(' ')}"`);
      checked++;
    }
  }
  assert.ok(checked >= 10, `only ${checked} phrases checked`);
});

test('a phrase whose words never touch returns nothing, and still exits 0', () => {
  for (const f of fields.filter((_, i) => i % 23 === 0)) {
    const body = f.streams[1];
    if (body.length < 8) continue;
    const reversed = [body[5], body[4]];
    if (oracle(reversed).length > 0) continue;                 // a palindrome pair: not a probe
    const r = run(sample, 'query', `"${reversed.join(' ')}"`);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, '', `"${reversed.join(' ')}" matched something`);
    // ... while the same words unquoted are an ordinary query that answers.
    assert.ok(lines(run(sample, 'query', reversed.join(' ')).stdout).length > 0);
  }
});

test('the phrase filters, the ranking still ranks', () => {
  // Ten documents hold "shared phrase here"; the quoted answer must be those
  // documents in the order the unquoted ranking already puts them in.
  const rows = [];
  for (let i = 0; i < 14; i++) {
    rows.push({
      id: `p${String(i).padStart(2, '0')}`,
      title: i % 2 === 0 ? 'shared phrase here' : 'other',
      body: `${'filler '.repeat(i * 3)}shared phrase here ${i < 4 ? 'shared phrase here' : ''}`.trim(),
    });
  }
  rows.push({ id: 'apart', title: 'shared', body: 'phrase and here are apart' });
  const w = indexed(rows);
  const quoted = lines(run(w, 'query', '"shared phrase here"').stdout);
  const loose = lines(run(w, 'query', 'shared phrase here').stdout);
  assert.equal(quoted.length, 10, 'the ten best of fourteen matches');
  assert.ok(!quoted.includes('apart'), 'a document holding the words apart is not a phrase match');
  assert.ok(quoted.every((id) => id !== 'apart'));
  const order = quoted.filter((id) => loose.includes(id));
  assert.deepEqual(order, loose.filter((id) => quoted.includes(id)),
    'phrase results must keep the relevance order, not be re-sorted');
  assert.deepEqual(quoted[0], run(w, 'query', '"shared phrase here"').stdout.split('\n')[0], 'deterministic');
});

test('quoting is a property of the joined argument, not of how the shell split it', () => {
  const phrase = fields[0].streams[1].slice(0, 3);
  const whole = run(sample, 'query', `"${phrase.join(' ')}"`).stdout;
  const split = run(sample, 'query', `"${phrase[0]}`, phrase[1], `${phrase[2]}"`).stdout;
  assert.equal(split, whole, 'arguments are joined with single spaces before quoting is read');
  assert.ok(lines(whole).length > 0);
});

test('an unterminated quote is an ordinary query, not an empty answer', () => {
  const phrase = fields[0].streams[1].slice(0, 3);
  const dangling = run(sample, 'query', `"${phrase.join(' ')}`);
  assert.equal(dangling.status, 0, dangling.stderr);
  assert.equal(dangling.stdout, run(sample, 'query', phrase.join(' ')).stdout,
    'a half-quoted query must behave exactly like the unquoted one');
});

test('two quoted phrases must both match; loose words outside them still rank', () => {
  const w = indexed([
    { id: 'both', title: 'alpha beta', body: 'gamma delta rare' },
    { id: 'first', title: 'alpha beta', body: 'delta gamma' },
    { id: 'second', title: 'beta alpha', body: 'gamma delta' },
    { id: 'neither', title: 'beta alpha', body: 'delta gamma rare' },
  ]);
  assert.deepEqual(lines(run(w, 'query', '"alpha beta" "gamma delta"').stdout), ['both']);
  assert.deepEqual(lines(run(w, 'query', '"alpha beta"').stdout).sort(), ['both', 'first']);
  assert.deepEqual(lines(run(w, 'query', '"alpha beta" rare').stdout), ['both', 'first'],
    'the loose term ranks inside the phrase matches, it does not filter them');
});

test('a phrase may not straddle the title and the body, through the CLI', () => {
  const w = indexed([
    { id: 'straddle', title: 'ends here', body: 'starts now' },
    { id: 'inbody', title: 'nothing', body: 'ends here starts now' },
  ]);
  assert.deepEqual(lines(run(w, 'query', '"here starts"').stdout), ['inbody']);
  assert.deepEqual(lines(run(w, 'query', '"ends here"').stdout).sort(), ['inbody', 'straddle']);
});

test('a single-word phrase is the plain term query, and stays capped at ten', () => {
  const common = fields[0].streams[1][0];
  const quoted = lines(run(sample, 'query', `"${common}"`).stdout);
  assert.deepEqual(quoted, lines(run(sample, 'query', common).stdout));
  assert.ok(quoted.length <= 10);
  assert.ok(quoted.every((id) => oracle([common]).includes(id)));
});

test('quoting changes nothing else: stats, indexing and the error paths', () => {
  const before = run(sample, 'stats').stdout;
  run(sample, 'query', '"wadiki dixo"');
  assert.equal(run(sample, 'stats').stdout, before, 'a query must not touch the index');
  assert.deepEqual(Object.keys(JSON.parse(before)).sort(), ['docs', 'indexBytes', 'skipped']);
  const noArgs = run(sample, 'query');
  assert.equal(noArgs.status, 1);
  assert.equal(noArgs.stdout, '');
  const empty = run(sample, 'query', '""');
  assert.equal(empty.status, 0, empty.stderr);
  assert.equal(empty.stdout, '', 'an empty phrase has no terms to rank, so nothing is printed');
  const unindexed = workdir();
  const early = run(unindexed, 'query', '"alpha beta"');
  assert.equal(early.status, 1);
  assert.equal(early.stdout, '');
  assert.ok(early.stderr.trim().length > 0);
});

test('the CLI is still a composition layer, not a second implementation', () => {
  const src = fs.readFileSync(CLI, 'utf8');
  for (const mod of ['lib/corpus.mjs', 'lib/analyze.mjs', 'lib/index-format.mjs', 'lib/rank.mjs', 'lib/phrase.mjs']) {
    assert.ok(src.includes(mod), `search.mjs does not import ${mod}`);
  }
  assert.ok(!/["']\s*\.\s*indexOf\(|positions|adjacent/.test(src.replace(/^\s*\/\/.*$/gm, '')),
    'phrase matching must live in lib/phrase.mjs, not in the CLI');
  assert.ok(!/require\(|from ['"][^.n]/.test(src.replace(/from ['"]node:[^'"]+['"]/g, '')), 'search.mjs must have zero runtime dependencies');
  const codeLines = src.split('\n').filter((l) => l.trim() !== '' && !l.trim().startsWith('//')).length;
  assert.ok(codeLines < 120, `search.mjs has ${codeLines} code lines — logic that belongs in lib/ has leaked into the CLI`);
});
