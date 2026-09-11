// Gate for the slow-loop-instruments contract: (1) a misalignment report that
// mines git co-change history and contrasts it with the impact scope the
// contract tree implies, (2) a cold-agent drill runner whose counted
// files-read/turns are the codebase-quality trend metric.
//
// Git-dependent tests build their own throwaway repository: a gate that reads
// the host repository's history would be unreproducible and would pass or fail
// for reasons the implementation does not control.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tool = (name, ...args) =>
  spawnSync('node', [path.join(repoRoot, 'tools', name), ...args], { encoding: 'utf8', timeout: 120000 });
const misalign = (dir, ...args) => tool('misalign.mjs', '--dir', dir, ...args);
const drill = (dir, ...args) => tool('drill.mjs', ...args, '--dir', dir);

const git = (dir, ...args) => {
  const r = spawnSync('git', ['-C', dir, '-c', 'user.name=b2m gate', '-c', 'user.email=gate@build2me.invalid',
    '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8', timeout: 60000 });
  assert.equal(r.status, 0, `git ${args.join(' ')} failed: ${r.stdout}${r.stderr}`);
  return r.stdout.trim();
};

const write = (dir, rel, content) => {
  fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), content);
};
const contract = (name) => JSON.stringify({
  name, title: `${name} contract`, interface: `interface of ${name}`, acceptance: 'true',
  nl_description: `fixture contract ${name}`, serves: null, env: 'node>=20',
}, null, 2);
const meta = (name, imports, files) => JSON.stringify({ contract: name, kind: 'implementation', imports, files, notes: '' }, null, 2);

// One commit touching exactly `rels`, each file bumped so the commit is non-empty.
const commit = (repo, project, message, rels) => {
  for (const rel of rels) {
    const p = path.join(project, rel);
    fs.appendFileSync(p, `// ${message}\n`);
  }
  git(repo, 'add', '--', ...rels.map((r) => path.relative(repo, path.join(project, r))));
  git(repo, 'commit', '-q', '-m', message);
  return git(repo, 'rev-parse', 'HEAD');
};

// A project whose contract tree deliberately disagrees with its history:
//   alpha (src/alpha/, a directory claim) and beta have no import path, yet
//   their files change together three times -> the one expected finding;
//   alpha/a + alpha/b (same contract), gamma + delta (direct import) and
//   zeta + delta (zeta -> gamma -> delta, transitive) are all explained by the
//   tree; alpha/b + beta co-changes once, under the "repeatedly" threshold;
//   README.md belongs to no submission at all -> unmapped, never a finding.
const misalignFixture = () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'b2m-misalign-'));
  git(repo, 'init', '-q', '-b', 'main');
  for (const name of ['alpha', 'beta', 'gamma', 'delta', 'zeta']) write(repo, `contracts/${name}.json`, contract(name));
  write(repo, 'impl/alpha/sub-001/meta.json', meta('alpha', [], ['src/alpha']));
  write(repo, 'impl/beta/sub-001/meta.json', meta('beta', [], ['src/beta.mjs']));
  write(repo, 'impl/gamma/sub-001/meta.json', meta('gamma', ['delta'], ['src/gamma.mjs']));
  write(repo, 'impl/delta/sub-001/meta.json', meta('delta', [], ['src/delta.mjs']));
  write(repo, 'impl/zeta/sub-001/meta.json', meta('zeta', ['gamma'], ['src/zeta.mjs']));
  write(repo, 'README.md', '# fixture\n');
  for (const rel of ['src/alpha/a.mjs', 'src/alpha/b.mjs', 'src/beta.mjs', 'src/gamma.mjs', 'src/delta.mjs', 'src/zeta.mjs']) {
    write(repo, rel, 'export default null;\n');
  }

  git(repo, 'add', 'contracts', 'impl', 'README.md');
  git(repo, 'commit', '-q', '-m', 'scaffold');
  git(repo, 'add', 'src/alpha');
  git(repo, 'commit', '-q', '-m', 'alpha: initial');
  git(repo, 'add', 'src/beta.mjs');
  git(repo, 'commit', '-q', '-m', 'beta: initial');
  git(repo, 'add', 'src/gamma.mjs', 'src/delta.mjs');
  git(repo, 'commit', '-q', '-m', 'gamma/delta: initial');
  git(repo, 'add', 'src/zeta.mjs');
  git(repo, 'commit', '-q', '-m', 'zeta: initial');

  const coupled = [
    commit(repo, repo, 'feature one', ['src/alpha/a.mjs', 'src/beta.mjs']),
    commit(repo, repo, 'feature two', ['src/alpha/a.mjs', 'src/beta.mjs']),
    commit(repo, repo, 'feature three', ['src/alpha/a.mjs', 'src/beta.mjs']),
  ];
  commit(repo, repo, 'alpha refactor one', ['src/alpha/a.mjs', 'src/alpha/b.mjs']);
  commit(repo, repo, 'alpha refactor two', ['src/alpha/a.mjs', 'src/alpha/b.mjs']);
  commit(repo, repo, 'gamma/delta sync', ['src/gamma.mjs', 'src/delta.mjs']);
  commit(repo, repo, 'zeta/delta sync one', ['src/zeta.mjs', 'src/delta.mjs']);
  commit(repo, repo, 'zeta/delta sync two', ['src/zeta.mjs', 'src/delta.mjs']);
  commit(repo, repo, 'one-off touch', ['src/alpha/b.mjs', 'src/beta.mjs']);
  commit(repo, repo, 'docs', ['README.md']);
  return { dir: repo, coupled };
};

const pairs = (report) => report.findings.map((f) => f.files.map((x) => x.path).join(' + '));

test('misalign: reports the file pair that repeatedly co-changes across unlinked contracts', () => {
  const { dir, coupled } = misalignFixture();
  const r = misalign(dir, '--json');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const report = JSON.parse(r.stdout);

  assert.deepEqual(pairs(report), ['src/alpha/a.mjs + src/beta.mjs']);
  const f = report.findings[0];
  assert.equal(f.cochanges, 3);
  assert.deepEqual(f.files.map((x) => x.contracts), [['alpha'], ['beta']]);
  assert.deepEqual([...f.commits].sort(), [...coupled].sort(), 'the finding must name the commits it was mined from');
  assert.match(f.suggestion ?? '', /alpha|beta/, 'each finding carries a refactoring suggestion');
  assert.equal(report.commits, 15);
});

test('misalign: co-changes the contract tree already explains are not findings', () => {
  const { dir } = misalignFixture();
  const r = misalign(dir, '--json');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const found = pairs(JSON.parse(r.stdout));
  // Same contract (claimed as a directory), a direct import edge, and a
  // transitive one (zeta -> gamma -> delta) all mean structure agrees with
  // history; a single co-change is not "repeatedly".
  assert.ok(!found.some((p) => p.includes('src/alpha/b.mjs')), `alpha-internal pair reported: ${found}`);
  assert.ok(!found.some((p) => p.includes('src/gamma.mjs')), `imported pair reported: ${found}`);
  assert.ok(!found.some((p) => p.includes('src/zeta.mjs')), `transitively imported pair reported: ${found}`);
});

test('misalign: files no submission claims are reported as unmapped, not as violations', () => {
  const { dir } = misalignFixture();
  const r = misalign(dir, '--json');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const report = JSON.parse(r.stdout);
  const readme = report.unmapped.find((u) => u.path === 'README.md');
  assert.ok(readme, `README.md missing from unmapped: ${JSON.stringify(report.unmapped)}`);
  assert.equal(readme.changes, 2);
  assert.ok(!JSON.stringify(report.findings).includes('README.md'), 'unmapped files must not appear as findings');
});

test('misalign: the human report names the files, the contracts and the commits', () => {
  const { dir, coupled } = misalignFixture();
  const r = misalign(dir);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /src\/alpha\/a\.mjs/);
  assert.match(r.stdout, /src\/beta\.mjs/);
  assert.match(r.stdout, /alpha/);
  assert.match(r.stdout, /beta/);
  assert.match(r.stdout, new RegExp(coupled[0].slice(0, 7)));
  assert.match(r.stdout, /README\.md/, 'unmapped files belong in the report too');
});

test('misalign: --since narrows the mined window', () => {
  const { dir, coupled } = misalignFixture();
  const r = misalign(dir, '--since', coupled[1], '--json');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const report = JSON.parse(r.stdout);
  assert.equal(report.commits, 8, 'only the commits after the given revision are mined');
  assert.deepEqual(pairs(report), [], 'one co-change inside the window is below the threshold');
});

test('misalign: an unknown --since revision fails legibly', () => {
  const { dir } = misalignFixture();
  const r = misalign(dir, '--since', 'no-such-rev', '--json');
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /no-such-rev/);
});

test('misalign: refuses a directory that is not a git repository', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'b2m-nogit-'));
  write(dir, 'contracts/alpha.json', contract('alpha'));
  write(dir, 'src/alpha.mjs', 'export default null;\n');
  write(dir, 'impl/alpha/sub-001/meta.json', meta('alpha', [], ['src/alpha.mjs']));
  const r = misalign(dir, '--json');
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /git/i);
});

test('misalign: works when the project lives in a subdirectory of the repository', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'b2m-subdir-'));
  const project = path.join(repo, 'proj');
  git(repo, 'init', '-q', '-b', 'main');
  write(repo, 'outside.txt', 'not part of the project\n');
  write(project, 'contracts/one.json', contract('one'));
  write(project, 'contracts/two.json', contract('two'));
  write(project, 'impl/one/sub-001/meta.json', meta('one', [], ['src/one.mjs']));
  write(project, 'impl/two/sub-001/meta.json', meta('two', [], ['src/two.mjs']));
  write(project, 'src/one.mjs', 'export default null;\n');
  write(project, 'src/two.mjs', 'export default null;\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'scaffold');
  commit(repo, project, 'change one', ['src/one.mjs', 'src/two.mjs', '../outside.txt']);
  commit(repo, project, 'change two', ['src/one.mjs', 'src/two.mjs', '../outside.txt']);

  const r = misalign(project, '--json');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const report = JSON.parse(r.stdout);
  assert.deepEqual(pairs(report), ['src/one.mjs + src/two.mjs'], 'paths are relative to the project');
  assert.ok(!JSON.stringify(report).includes('outside.txt'), 'changes outside the project are not mined');
});

// --- drill runner -----------------------------------------------------------

const drillProject = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'b2m-drill-'));
  write(dir, 'drills/find-status.json', JSON.stringify({
    id: 'find-status',
    prompt: 'Where is a contract status derived?',
    expected: { files_to_find: ['tools/lib.mjs'], answer_pattern: 'computeStatus' },
    budget: { max_files_read: 5, max_turns: 3 },
  }, null, 2));
  write(dir, 'drills/find-log.json', JSON.stringify({
    id: 'find-log',
    prompt: 'Which file records deprecations?',
    expected: { files_to_find: ['laws/deprecations.log'] },
    budget: { max_files_read: 4, max_turns: 2 },
  }, null, 2));
  write(dir, 'drills/results.log', '# append-only\n');
  return dir;
};
const resultsOf = (dir) => fs.readFileSync(path.join(dir, 'drills', 'results.log'), 'utf8');
const appended = (before, after) => {
  assert.ok(after.startsWith(before), 'drills/results.log must be appended to, never rewritten');
  return after.slice(before.length).split('\n').filter((l) => l.trim() !== '' && !l.trim().startsWith('#'));
};

test('drill list: this repository ships usable drills', () => {
  const r = tool('drill.mjs', 'list', '--dir', repoRoot, '--json');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const out = JSON.parse(r.stdout);
  assert.ok(out.drills.length >= 2, `expected at least two shipped drills, got ${out.drills.length}`);
  for (const d of out.drills) {
    assert.equal(typeof d.id, 'string');
    assert.ok(d.prompt.trim().length > 0, `drill ${d.id} has no prompt`);
    assert.ok(d.expected.files_to_find || d.expected.answer_pattern, `drill ${d.id} declares no expectation`);
    assert.ok(d.budget.max_files_read || d.budget.max_turns, `drill ${d.id} declares no budget`);
  }
  const text = tool('drill.mjs', 'list', '--dir', repoRoot);
  assert.equal(text.status, 0, text.stdout + text.stderr);
  assert.match(text.stdout, new RegExp(out.drills[0].id));
});

test('drill record: a within-budget attempt that meets expectations PASSes and is appended', () => {
  const dir = drillProject();
  const before = resultsOf(dir);
  const r = drill(dir, 'record', 'find-status', '--files-read', '3', '--turns', '2',
    '--found', 'tools/lib.mjs', '--answer', 'computeStatus in tools/lib.mjs', '--notes', 'cold run, no hints');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /PASS/);

  const lines = appended(before, resultsOf(dir));
  assert.equal(lines.length, 1, 'exactly one result line per record');
  const rec = JSON.parse(lines[0]);
  assert.equal(rec.drill, 'find-status');
  assert.equal(rec.result, 'PASS');
  assert.equal(rec.files_read, 3);
  assert.equal(rec.turns, 2);
  assert.deepEqual(rec.found, ['tools/lib.mjs']);
  assert.match(rec.notes, /cold run/);
});

test('drill record: exceeding the budget FAILs and names the budget', () => {
  const dir = drillProject();
  const before = resultsOf(dir);
  const r = drill(dir, 'record', 'find-status', '--files-read', '12', '--turns', '2',
    '--found', 'tools/lib.mjs', '--answer', 'computeStatus');
  assert.notEqual(r.status, 0, 'a failing drill must not report success');
  assert.match(r.stdout, /FAIL/);
  assert.match(r.stdout, /files.read|budget/i);
  assert.match(r.stdout, /12|5/);
  const lines = appended(before, resultsOf(dir));
  assert.equal(lines.length, 1, 'failures are recorded too — they are the trend data');
  assert.equal(JSON.parse(lines[0]).result, 'FAIL');
});

test('drill record: a missing expected file FAILs and names the path', () => {
  const dir = drillProject();
  const r = drill(dir, 'record', 'find-log', '--files-read', '1', '--turns', '1', '--found', 'README.md');
  assert.notEqual(r.status, 0);
  assert.match(r.stdout, /FAIL/);
  assert.match(r.stdout, /laws\/deprecations\.log/);
});

test('drill record: the answer must match the drill answer_pattern', () => {
  const dir = drillProject();
  const r = drill(dir, 'record', 'find-status', '--files-read', '2', '--turns', '1',
    '--found', 'tools/lib.mjs', '--answer', 'somewhere in the tools directory');
  assert.notEqual(r.status, 0);
  assert.match(r.stdout, /FAIL/);
  assert.match(r.stdout, /computeStatus/);
});

test('drill record: an unknown drill id errors and leaves the log untouched', () => {
  const dir = drillProject();
  const before = resultsOf(dir);
  const r = drill(dir, 'record', 'no-such-drill', '--files-read', '1', '--turns', '1', '--found', 'x.mjs');
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /no-such-drill/);
  assert.equal(resultsOf(dir), before);
});

test('drill report: aggregates attempts, pass rate and average files read per drill', () => {
  const dir = drillProject();
  // Two attempts inside the 5-file budget, one over it: the report must mix them.
  drill(dir, 'record', 'find-status', '--files-read', '5', '--turns', '3', '--found', 'tools/lib.mjs', '--answer', 'computeStatus');
  drill(dir, 'record', 'find-status', '--files-read', '2', '--turns', '1', '--found', 'tools/lib.mjs', '--answer', 'computeStatus');
  drill(dir, 'record', 'find-status', '--files-read', '9', '--turns', '1', '--found', 'tools/lib.mjs', '--answer', 'computeStatus');

  const r = drill(dir, 'report', '--json');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const out = JSON.parse(r.stdout);
  const row = out.drills.find((d) => d.id === 'find-status');
  assert.ok(row, `find-status missing from report: ${r.stdout}`);
  assert.equal(row.attempts, 3);
  assert.equal(row.passes, 2);
  assert.equal(row.pass_rate, 0.67);
  assert.equal(row.avg_files_read, 5.33);
  assert.equal(row.avg_turns, 1.67);
  assert.equal(row.first_files_read, 5);
  assert.equal(row.last_files_read, 9);

  const untried = out.drills.find((d) => d.id === 'find-log');
  assert.ok(untried, 'drills with no attempt yet belong in the report');
  assert.equal(untried.attempts, 0);

  const text = drill(dir, 'report');
  assert.equal(text.status, 0, text.stdout + text.stderr);
  assert.match(text.stdout, /find-status/);
  assert.match(text.stdout, /3/);
});

test('both instruments ship, documented and dependency-free (law L1)', () => {
  for (const name of ['misalign.mjs', 'drill.mjs']) {
    const src = fs.readFileSync(path.join(repoRoot, 'tools', name), 'utf8');
    assert.match(src.slice(0, 400), /^\/\/|\n\/\//, `${name} must open with a header comment`);
    for (const m of src.matchAll(/^\s*import\s+[^;]*?from\s+'([^']+)'/gm)) {
      assert.ok(m[1].startsWith('node:') || m[1].startsWith('.'), `${name} imports "${m[1]}" — law L1 allows only node builtins`);
    }
  }
  const format = fs.readFileSync(path.join(repoRoot, 'tools', 'drill.mjs'), 'utf8').slice(0, 3000);
  assert.match(format, /files_to_find/, 'the drills/ format is documented in the runner header');
  assert.match(format, /budget/, 'the drills/ format is documented in the runner header');
  assert.match(fs.readFileSync(path.join(repoRoot, 'drills', 'results.log'), 'utf8'), /append-only/);
});
