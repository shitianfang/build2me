#!/usr/bin/env node
// Deprecation: the only way a contract ever changes. Requirements go wrong in a
// way theorems cannot, so a wrong contract is never edited or deleted — one line
// is appended to laws/deprecations.log and the verifier stops calling it Done.
//
// Every submission importing a deprecated contract degrades to SKETCH_ACCEPTED
// and its own contract re-opens, so the re-open propagates upward: the cascade
// in reverse. This tool names that set at deprecation time, because the agents
// who have to re-point those submissions at a successor are the audience.
//
// Reading is delegated to the shared engine (tools/lib.mjs) so "what imports
// what" and "what counts as deprecated" have exactly one implementation.
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { loadProject } from './lib.mjs';

const USAGE = 'usage: node tools/deprecate.mjs <contract> --reason <text> [--dir <project>]';

function fail(cause, remedy) {
  console.error(`ERROR: ${cause}`);
  if (remedy) console.error(`  ${remedy}`);
  process.exit(1);
}

function parseArgs(argv) {
  const opts = { contract: null, reason: null, dir: '.' };
  const VALUED = { '--reason': 'reason', '--dir': 'dir' };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      console.log(USAGE);
      process.exit(0);
    }
    const eq = /^(--reason|--dir)=([\s\S]*)$/.exec(arg);
    if (eq) {
      opts[VALUED[eq[1]]] = eq[2];
      continue;
    }
    if (VALUED[arg]) {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('-')) {
        fail(`${arg} needs a value, but got ${value === undefined ? 'nothing' : `the option "${value}"`}`,
          `write ${arg} <value>, or ${arg}=<value> if the value itself starts with "-". ${USAGE}`);
      }
      opts[VALUED[arg]] = value;
      i++;
      continue;
    }
    if (arg.startsWith('-')) fail(`unknown option "${arg}"`, USAGE);
    if (opts.contract !== null) {
      fail(`unexpected extra argument "${arg}" (already deprecating "${opts.contract}")`,
        'deprecate one contract per run, and quote a multi-word reason: --reason "changed requirement"');
    }
    opts.contract = arg;
  }
  return opts;
}

const opts = parseArgs(process.argv.slice(2));
const dir = path.resolve(opts.dir);

if (opts.contract === null) fail('no contract name given', USAGE);
// One line per deprecation is the file's whole format; collapse any whitespace
// the shell passed through rather than corrupting the log with a second line.
const reason = (opts.reason ?? '').replace(/\s+/g, ' ').trim();
if (reason === '') {
  fail(`no reason given for deprecating "${opts.contract}"`,
    'a deprecation is a message to the agents who must repair the dependents: --reason "superseded by <successor>"');
}
if (!fs.existsSync(path.join(dir, 'contracts'))) {
  fail(`${dir} is not a build2me project: it has no contracts/ directory`,
    'run this from the project root, or point at one with --dir <project>');
}

const project = loadProject(dir);
if (!project.contracts.has(opts.contract)) {
  const known = [...project.contracts.keys()].sort();
  fail(`no contract named "${opts.contract}" in ${path.join(dir, 'contracts')}`,
    known.length === 0
      ? 'that directory holds no contracts yet; nothing can be deprecated'
      : `contracts here: ${known.join(', ')}`);
}
const name = opts.contract;

const logPath = path.join(dir, 'laws', 'deprecations.log');
const logExisted = fs.existsSync(logPath);
const before = logExisted ? fs.readFileSync(logPath, 'utf8') : '';
if (project.deprecated.has(name)) {
  const existing = before.split('\n').find((l) => l.trim().split(/\s+/)[0] === name) ?? name;
  fail(`"${name}" is already deprecated: ${existing.trim()}`,
    'the log is append-only and a contract is deprecated once; to change the reason, append a successor contract instead of re-deprecating this one');
}

// Reverse-import closure: a submission importing a deprecated contract can never
// have all imports Done, so its contract re-opens — and dependents of THAT
// contract re-open with it. Already-deprecated contracts stay deprecated.
const dependents = new Map(); // contract -> { depth, via }
for (let frontier = [name]; frontier.length > 0; ) {
  const next = [];
  for (const target of frontier) {
    for (const s of project.submissions) {
      if (!s.imports.includes(target) || s.contract === name) continue;
      if (dependents.has(s.contract) || project.deprecated.has(s.contract)) continue;
      dependents.set(s.contract, { depth: (dependents.get(target)?.depth ?? 0) + 1, via: s.key });
      next.push(s.contract);
    }
  }
  frontier = next;
}

// Append, never rewrite (law L3): one line, and a separator only if an earlier
// writer left the file without a trailing newline.
const separator = before === '' || before.endsWith('\n') ? '' : '\n';
const header = logExisted ? '' : '# append-only — one line per deprecated contract: <contract-name> <reason>\n';
fs.mkdirSync(path.dirname(logPath), { recursive: true });
fs.appendFileSync(logPath, `${header}${separator}${name} ${reason}\n`);

const rows = [...dependents.entries()].sort((a, b) => a[1].depth - b[1].depth || a[0].localeCompare(b[0]));
console.log(`deprecated ${name} — ${reason}`);
console.log(`  appended to ${path.join('laws', 'deprecations.log')}`);
if (rows.length === 0) {
  console.log(`\n  no contract imports ${name}; nothing re-opens.`);
} else {
  const n = rows.length === 1 ? '1 contract re-opens' : `${rows.length} contracts re-open`;
  console.log(`\n  ${n} — every submission below now degrades to SKETCH_ACCEPTED:`);
  for (const [dep, { depth, via }] of rows) {
    console.log(`    ${dep.padEnd(28)} ${depth === 1 ? 'imports it' : 'downstream'} via impl/${via}`);
  }
  console.log('\n  Repair: publish a successor contract and submit a replacement that imports it.');
  console.log('  Merged submissions are immutable — supersede them, never edit them.');
}
