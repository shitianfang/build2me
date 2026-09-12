#!/usr/bin/env node
// Scaffold a new build2me project: the entry point for using the protocol on
// your own work rather than reading this repository. It installs the kernel,
// writes one root contract with a starter gate, and leaves a project that
// verifies green with its root Open — the first decomposition is yours.
//
// Usage: node tools/init.mjs <target-dir> [--root <contract-name>] [--force]
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = path.resolve(here, '..');
const USAGE = 'usage: node tools/init.mjs <target-dir> [--root <contract-name>] [--force]';

// Every check runs before the first write, so a refused init leaves the
// target directory untouched.
const fail = (message, ...hints) => {
  console.error(`init: ${message}`);
  for (const hint of hints) console.error(`  ${hint}`);
  process.exit(1);
};

const argv = process.argv.slice(2);
const flags = { root: null, force: false };
const positional = [];
for (let i = 0; i < argv.length; i++) {
  const arg = argv[i];
  if (arg === '--help' || arg === '-h') {
    console.log(USAGE);
    process.exit(0);
  } else if (arg === '--force') {
    flags.force = true;
  } else if (arg === '--root') {
    const value = argv[++i];
    if (value === undefined || value.startsWith('--')) fail('--root needs a value', USAGE);
    flags.root = value;
  } else if (arg.startsWith('-') && arg !== '-') {
    fail(`unknown option "${arg}"`, USAGE);
  } else {
    positional.push(arg);
  }
}

if (positional.length === 0) fail('no target directory given', USAGE);
if (positional.length > 1) fail(`expected one target directory, got ${positional.length}`, USAGE);
const target = path.resolve(positional[0]);

const rootName = flags.root ?? path.basename(target);
// Contract names address files, log lines, and stub modules, so the grammar is
// deliberately narrow — a name with whitespace or a leading "#" cannot be
// recorded in laws/deprecations.log at all.
if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(rootName)) {
  fail(`"${rootName}" is not a usable contract name`,
    'use letters, digits, dot, underscore or dash, starting with a letter or digit',
    'pass a different one with --root <contract-name>');
}

if (fs.existsSync(target)) {
  if (!fs.statSync(target).isDirectory()) fail(`"${target}" exists and is not a directory`);
  const entries = fs.readdirSync(target).filter((e) => e !== '.git');
  if (entries.length > 0 && !flags.force) {
    fail(`"${target}" is not empty (${entries.length} entr${entries.length === 1 ? 'y' : 'ies'})`,
      'pass --force to scaffold into it anyway — existing files are never deleted or overwritten');
  }
}

const KERNEL = ['lib.mjs', 'verify.mjs', 'frontier.mjs', 'graph.mjs', 'deprecate.mjs', 'revise.mjs', 'stub.mjs', 'check-immutability.sh'];
const written = [];
const write = (rel, content) => {
  const file = path.join(target, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (fs.existsSync(file)) return; // --force adds, never overwrites
  fs.writeFileSync(file, content);
  written.push(rel);
};

for (const dir of ['contracts', 'impl', 'laws', 'acceptance', 'tools']) {
  fs.mkdirSync(path.join(target, dir), { recursive: true });
}
for (const tool of KERNEL) write(path.join('tools', tool), fs.readFileSync(path.join(source, 'tools', tool)));
fs.chmodSync(path.join(target, 'tools', 'check-immutability.sh'), 0o755);
write('PROTOCOL.md', fs.readFileSync(path.join(source, 'PROTOCOL.md')));

write(path.join('contracts', `${rootName}.json`), `${JSON.stringify({
  name: rootName,
  title: `${rootName}: state here, in one line, what this system must do`,
  interface: 'The externally visible behavior of the finished system: the commands, APIs, or screens it must expose. Silent about how. Replace this text before decomposing — once a submission exists, this statement is immutable.',
  acceptance: `node --test acceptance/${rootName}.test.mjs`,
  nl_description: 'The root statement. It is Done when every child contract is Done and this gate passes.',
  serves: null,
  env: 'node>=20',
}, null, 2)}\n`);

write(path.join('acceptance', `${rootName}.test.mjs`), `// The completion criterion for the whole system. It runs only when every
// child contract has been ACCEPTED in the same verification pass, so it must
// use STRUCTURAL status: querying accurate status from inside a completion
// gate re-enters this gate.
//
// The frontier check alone is NOT a completion criterion: at the moment of
// cascade it is true by construction and certifies nothing. The second test
// below fails on purpose until you replace it with real end-to-end checks
// of the finished system — root cannot close on a vacuous gate.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('the frontier is empty', () => {
  const r = spawnSync('node', [path.join(projectRoot, 'tools', 'frontier.mjs'), '--dir', projectRoot, '--json', '--structural'],
    { encoding: 'utf8', timeout: 60000 });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const open = JSON.parse(r.stdout).open.map((c) => c.name);
  assert.deepEqual(open, [], \`still open: \${open.join(', ')}\`);
});

test('the composed system answers as one', () => {
  // Replace this with end-to-end assertions against the FINISHED system:
  // run its CLI, hit its API, load the composed module — whatever proves the
  // parts work together. Until then this gate stays red, by design.
  assert.fail('root gate not written yet: replace this assertion with an end-to-end check of the finished system');
});
`);

write(path.join('laws', 'laws.md'), `# Laws

Laws are this project's axiom system: the rules every submission must conform
to. Conformance is checkable instantly — but only relative to the law as
written. Laws are amended by humans, deliberately; git is their version history.

A law is only a law if something enforces it. Prose without a check is advice.

- **L1 — contracts are immutable.** Contract files may only be added, never
  modified or deleted. Enforced by \`tools/check-immutability.sh\`. Contracts
  still change — by revision, never by editing:
  \`node tools/revise.mjs <name> --set field=value --reason ...\` publishes the
  successor, deprecates the predecessor, and the frontier lists every reopened
  dependent with the successor to re-point at.
- **L2 — deprecations.log is append-only.** Enforced by the same script.

Add your own as you build — not before. You cannot know up front which
dimensions this project needs to hold; you discover them: a slow page, an
unreadable module, a doc that lied. The moment one bites, freeze it as a law
so it can never bite again unnoticed:

1. Measure where you stand today; that number is the floor (the ground you
   already hold — start there, not at where you wish you were).
2. Write \`laws/<id>.json\` with {id, dimension, statement, check} — check is
   a command that exits 0 while the floor holds. The verifier runs it on
   every pass from now on.
3. Tighten the floor deliberately when you have margin; never loosen it
   silently.

A check must never call verify.mjs (verify runs the laws — it would re-enter).
`);

write(path.join('laws', 'deprecations.log'), '# append-only — one line per deprecated contract: <contract-name> <reason>\n');

write('README.md', `# ${rootName}

A [build2me](https://github.com/shitianfang/build2me) project: contracts are
immutable statements with machine-checkable acceptance, agents work the frontier
without locks, and the verifier is the only judge.

\`\`\`sh
node tools/verify.mjs     # the kernel — statuses, verdicts, gates
node tools/frontier.mjs   # what to work on next, ranked by closability
\`\`\`

Start by rewriting \`contracts/${rootName}.json\` to say what this system must
do, then decompose it: publish child contracts with their gates, and submit a
decomposition on the root that imports them. \`PROTOCOL.md\` is the full
protocol — an agent that has read it can participate correctly.
`);

write(path.join('.github', 'workflows', 'verify.yml'), `name: verify
on: [push, pull_request]
jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - name: contract immutability
        run: |
          if [ "\${{ github.event_name }}" = "pull_request" ]; then
            bash tools/check-immutability.sh "origin/\${{ github.base_ref }}"
          else
            bash tools/check-immutability.sh "HEAD~1"
          fi
      - name: verify
        run: node tools/verify.mjs
`);

console.log(`build2me project created at ${target}`);
console.log(`  root contract: ${rootName}    (${written.length} files written)`);
console.log('\nnext:');
console.log(`  1. edit contracts/${rootName}.json — say what the system must do`);
console.log(`  2. node tools/verify.mjs --dir ${positional[0]}     # green, root Open`);
console.log(`  3. node tools/frontier.mjs --dir ${positional[0]}   # your work queue`);
console.log('  4. decompose: publish child contracts with gates, then submit a');
console.log(`     decomposition on ${rootName} that imports them (PROTOCOL.md)`);
