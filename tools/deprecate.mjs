#!/usr/bin/env node
// Deprecation: the only way a contract's statement ever changes. Contracts are
// immutable, so a wrong, superseded, or obsolete one is retired by APPENDING a
// single line to laws/deprecations.log — never by editing or deleting anything
// (law L3). History is not rewritten, so everything ever built stays auditable.
//
// A deprecated contract can never become Done, so every submission importing it
// degrades to SKETCH_ACCEPTED and that submission's own contract re-opens — and
// so on upward: the cascade in reverse. This tool writes the log line and names
// the whole set the verifier will now hold Open, because that set is the work
// the deprecation just created: each of those submissions must be re-pointed at
// a successor contract.
//
// Usage: node tools/deprecate.mjs <contract> --reason <text> [--dir <project>]
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { loadProject } from './lib.mjs';

const USAGE = 'usage: node tools/deprecate.mjs <contract> --reason <text> [--dir <project>]';

// Every failure path exits before touching the log, so a refused deprecation
// always leaves laws/deprecations.log byte-identical.
const fail = (message, ...hints) => {
  console.error(`deprecate: ${message}`);
  for (const hint of hints) console.error(`  ${hint}`);
  process.exit(1);
};

const argv = process.argv.slice(2);
const flags = { dir: '.', reason: null };
const positional = [];
for (let i = 0; i < argv.length; i++) {
  const arg = argv[i];
  if (arg === '--help' || arg === '-h') {
    console.log(USAGE);
    process.exit(0);
  }
  const eq = arg.startsWith('--') ? arg.indexOf('=') : -1;
  const key = eq === -1 ? arg : arg.slice(0, eq);
  if (key === '--dir' || key === '--reason') {
    const value = eq === -1 ? argv[++i] : arg.slice(eq + 1);
    // A flag swallowing the next flag is always a typo, never an intent.
    if (value === undefined || (eq === -1 && value.startsWith('--'))) fail(`${key} needs a value`, USAGE);
    flags[key.slice(2)] = value;
  } else if (arg.startsWith('-') && arg !== '-') {
    fail(`unknown option "${arg}"`, USAGE);
  } else {
    positional.push(arg);
  }
}

if (positional.length === 0) fail('no contract name given', USAGE);
if (positional.length > 1) {
  fail(`expected one contract name, got ${positional.length} (${positional.join(', ')})`,
    'quote a multi-word reason: --reason "requirement changed"');
}
const name = positional[0];
// The log is one whitespace-separated line per deprecation; a name carrying
// whitespace would be re-read as a different (shorter) contract name, and a
// leading "#" would be re-read as a comment — either way the deprecation
// would silently not exist.
if (/\s/.test(name)) fail(`contract name "${name}" contains whitespace`, 'deprecations.log records <contract-name> <reason> on one line');
if (name.startsWith('#')) fail(`contract name "${name}" starts with "#", which the log format reads as a comment`, 'this name cannot be recorded in laws/deprecations.log');
if (flags.reason === null) fail('--reason is required: a deprecation must record why, for the agent that finds it later', USAGE);
// Collapse newlines/runs of spaces so one deprecation is always exactly one line.
const reason = flags.reason.replace(/\s+/g, ' ').trim();
if (reason === '') fail('--reason must not be empty', USAGE);

const dir = path.resolve(flags.dir);
if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) fail(`project directory "${dir}" does not exist`, USAGE);
if (!fs.existsSync(path.join(dir, 'contracts'))) fail(`"${dir}" has no contracts/ directory, so it is not a build2me project root`, USAGE);

const project = loadProject(dir);
if (project.errors.length > 0) {
  console.error(`deprecate: warning — ${dir} has ${project.errors.length} structural problem(s) (see node tools/verify.mjs); the dependent list below may be incomplete.`);
}

if (!project.contracts.has(name)) {
  const file = path.join(dir, 'contracts', `${name}.json`);
  if (fs.existsSync(file)) {
    fail(`contracts/${name}.json exists but failed to load`, 'repair the contract file first — node tools/verify.mjs prints the reason');
  }
  fail(`unknown contract "${name}": contracts/${name}.json does not exist`,
    `known contracts: ${[...project.contracts.keys()].join(', ') || '(none)'}`);
}

const logPath = path.join(dir, 'laws', 'deprecations.log');
const existing = fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8') : '';
if (project.deprecated.has(name)) {
  const prior = existing.split('\n').find((l) => l.trim() !== '' && !l.trim().startsWith('#') && l.trim().split(/\s+/)[0] === name);
  fail(`"${name}" is already deprecated: ${prior?.trim() ?? name}`,
    'the log is append-only and a contract is retired once; publish a successor contract instead');
}

// Everything the verifier will hold Open: direct importers of the deprecated
// contract, then importers of those, transitively. Contracts that are already
// deprecated are neither reported nor traversed — they are already never-Done,
// so nothing changes for them or for anything above them.
const dependents = new Map(); // contract -> submission keys that reach the deprecation
const queue = [name];
const seen = new Set([name]);
while (queue.length > 0) {
  const current = queue.shift();
  for (const s of project.submissions) {
    if (!s.imports.includes(current) || s.contract === name || project.deprecated.has(s.contract)) continue;
    if (!dependents.has(s.contract)) dependents.set(s.contract, []);
    dependents.get(s.contract).push(`impl/${s.key} imports ${current}`);
    if (!seen.has(s.contract)) {
      seen.add(s.contract);
      queue.push(s.contract);
    }
  }
}

fs.mkdirSync(path.dirname(logPath), { recursive: true });
// Append only, and never join onto an unterminated last line.
const separator = existing !== '' && !existing.endsWith('\n') ? '\n' : '';
fs.appendFileSync(logPath, `${separator}${name} ${reason}\n`);

// Read-back verification: one check that closes every log-syntax trap at once.
// If the engine cannot see the deprecation that was just appended, reporting
// success would be a lie — demand repair instead.
if (!loadProject(dir).deprecated.has(name)) {
  console.error(`deprecate: FATAL — the appended line did not register as a deprecation of "${name}"`);
  console.error(`  inspect the last line of ${path.relative(dir, logPath)} and append a corrected line`);
  process.exit(2);
}

console.log(`deprecated ${name} — ${reason}`);
console.log(`  appended to ${path.relative(dir, logPath)}`);
if (dependents.size === 0) {
  console.log('\nnothing imports it: no contract re-opens.');
} else {
  const rows = [...dependents.entries()].sort(([a], [b]) => a.localeCompare(b));
  console.log(`\n${rows.length} dependent contract${rows.length === 1 ? '' : 's'}, now held Open until re-pointed at a successor:`);
  for (const [contract, vias] of rows) console.log(`  ${contract.padEnd(28)} ${vias.join(', ')}`);
  console.log('\nEvery submission listed above is now SKETCH_ACCEPTED. Publish a successor contract and supersede each submission with one importing it.');
}
