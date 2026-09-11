// Gate for contract "search-cli".
// Everything here is black-box: spawn search.mjs the way a user (and the
// judge) does. The working directory is a throwaway, which is exactly how
// the "./index relative to cwd" rule gets tested.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(projectRoot, 'search.mjs');
const SAMPLE = path.join(projectRoot, 'sample-docs.jsonl');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-cli-'));
let seq = 0;
const workdir = () => { const d = path.join(tmp, `w${seq++}`); fs.mkdirSync(d); return d; };
const run = (cwd, ...args) => spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8', timeout: 60000 });
const lines = (s) => s.split('\n').filter((l) => l !== '');
const writeCorpus = (dir, name, rows) => {
  const p = path.join(dir, name);
  fs.writeFileSync(p, rows.map((r) => (typeof r === 'string' ? r : JSON.stringify(r))).join('\n') + '\n');
  return p;
};

test('index writes ./index next to the working directory and exits 0', () => {
  const w = workdir();
  const r = run(w, 'index', SAMPLE);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(fs.existsSync(path.join(w, 'index')), 'no ./index directory was created');
  assert.ok(fs.readdirSync(path.join(w, 'index')).length > 0, './index is empty');
  assert.ok(!fs.existsSync(path.join(projectRoot, 'index', 'DO-NOT-EXIST')));
});

test('stats reports the indexed count, the exact skip count and the index size', () => {
  const w = workdir();
  assert.equal(run(w, 'index', SAMPLE).status, 0);
  const r = run(w, 'stats');
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.split('\n').filter((l) => l !== '').length, 1, 'stats must print exactly one line');
  const s = JSON.parse(r.stdout);
  assert.deepEqual(Object.keys(s).sort(), ['docs', 'indexBytes', 'skipped']);
  assert.equal(s.docs, 120);
  assert.equal(s.skipped, 5);
  const onDisk = fs.readdirSync(path.join(w, 'index')).reduce((n, f) => n + fs.statSync(path.join(w, 'index', f)).size, 0);
  assert.equal(s.indexBytes, onDisk);
});

test('query prints at most ten ids, one per line, best first', () => {
  const w = workdir();
  assert.equal(run(w, 'index', SAMPLE).status, 0);
  const r = run(w, 'query', 'wadiki dixo coza');
  assert.equal(r.status, 0, r.stderr);
  const out = lines(r.stdout);
  assert.ok(out.length > 0 && out.length <= 10, `got ${out.length} lines`);
  assert.ok(out.every((l) => /^\S+$/.test(l)), 'ids must be printed bare, one per line');
  assert.equal(new Set(out).size, out.length, 'no id may repeat');
  assert.deepEqual(out.slice(0, 3).sort(), ['doc-0-0', 'doc-0-1', 'doc-0-2']);
});

test('a query matching nothing prints nothing and still exits 0', () => {
  const w = workdir();
  assert.equal(run(w, 'index', SAMPLE).status, 0);
  const r = run(w, 'query', 'zzzznotaterm');
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, '');
  const empty = run(w, 'query', '   ');
  assert.equal(empty.status, 0);
  assert.equal(empty.stdout, '');
});

test('an unquoted multi-word query behaves like the quoted one', () => {
  const w = workdir();
  assert.equal(run(w, 'index', SAMPLE).status, 0);
  assert.equal(run(w, 'query', 'wadiki dixo coza').stdout, run(w, 'query', 'wadiki', 'dixo', 'coza').stdout);
});

test('indexing skips malformed lines, counts them exactly, and still exits 0', () => {
  const w = workdir();
  const file = writeCorpus(w, 'flawed.jsonl', [
    { id: 'k1', title: 'keeper one', body: 'alpha beta' },
    '{"id":"broken","title":"t","body":',
    '{"id":"nofields"}',
    'nonsense',
    '[]',
    { id: 'k2', title: 'keeper two', body: 'alpha gamma' },
  ]);
  const r = run(w, 'index', file);
  assert.equal(r.status, 0, r.stderr);
  const s = JSON.parse(run(w, 'stats').stdout);
  assert.equal(s.docs, 2);
  assert.equal(s.skipped, 4);
  assert.deepEqual(lines(run(w, 'query', 'alpha').stdout).sort(), ['k1', 'k2']);
});

test('re-indexing replaces the previous index completely', () => {
  const w = workdir();
  assert.equal(run(w, 'index', SAMPLE).status, 0);
  fs.writeFileSync(path.join(w, 'index', 'stale-shard.bin'), 'from an older run');
  const small = writeCorpus(w, 'small.jsonl', [{ id: 'only', title: 'lonely', body: 'singleton document' }]);
  assert.equal(run(w, 'index', small).status, 0);
  assert.ok(!fs.existsSync(path.join(w, 'index', 'stale-shard.bin')), 'a stale index file survived re-indexing');
  const s = JSON.parse(run(w, 'stats').stdout);
  assert.equal(s.docs, 1);
  assert.equal(s.skipped, 0);
  assert.equal(lines(run(w, 'query', 'wadiki').stdout).length, 0, 'documents from the previous corpus are still searchable');
  assert.deepEqual(lines(run(w, 'query', 'singleton').stdout), ['only']);
});

test('every error path: message on stderr, empty stdout, exit 1', () => {
  const w = workdir();
  const cases = [
    ['no command', []],
    ['unknown command', ['seek', 'x']],
    ['index without a path', ['index']],
    ['index with extra arguments', ['index', SAMPLE, 'extra']],
    ['index of a missing corpus', ['index', path.join(w, 'nope.jsonl')]],
    ['query without a term argument', ['query']],
    ['stats with arguments', ['stats', 'extra']],
    ['query before indexing', ['query', 'anything']],
    ['stats before indexing', ['stats']],
  ];
  for (const [label, args] of cases) {
    const r = run(w, ...args);
    assert.equal(r.status, 1, `${label}: expected exit 1, got ${r.status}`);
    assert.equal(r.stdout, '', `${label}: stdout must stay empty`);
    assert.ok(r.stderr.trim().length > 0, `${label}: expected a message on stderr`);
    // A crashed or absent CLI also exits 1 with an empty stdout: that is not
    // error handling, so a loader/runtime stack trace fails this gate.
    assert.ok(!/Cannot find module|ERR_MODULE_NOT_FOUND|at Object\.<anonymous>|at ModuleJob/.test(r.stderr),
      `${label}: the CLI crashed instead of reporting the error:\n${r.stderr}`);
  }
  assert.ok(!fs.existsSync(path.join(w, 'index')), 'a failing index run left a partial index behind');
});

test('the CLI is a composition layer, not a second implementation', () => {
  const src = fs.readFileSync(CLI, 'utf8');
  for (const mod of ['lib/corpus.mjs', 'lib/analyze.mjs', 'lib/index-format.mjs', 'lib/rank.mjs']) {
    assert.ok(src.includes(mod), `search.mjs does not import ${mod}`);
  }
  assert.ok(!/require\(|from ['"][^.n]/.test(src.replace(/from ['"]node:[^'"]+['"]/g, '')), 'search.mjs must have zero runtime dependencies');
  const codeLines = src.split('\n').filter((l) => l.trim() !== '' && !l.trim().startsWith('//')).length;
  assert.ok(codeLines < 120, `search.mjs has ${codeLines} code lines — logic that belongs in lib/ has leaked into the CLI`);
});
