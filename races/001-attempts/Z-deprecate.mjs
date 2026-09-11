#!/usr/bin/env node
// Deprecation: the only way a contract ever changes. Requirements go wrong in
// a way theorems cannot, so a contract file is never edited — it is retired by
// appending one line to laws/deprecations.log, and a successor is published
// under a new name.
//
// Retiring a contract un-Dones it, so this tool also prints the cascade in
// reverse: every contract whose submissions import the deprecated one —
// directly, or through another dependent — degrades to SKETCH_ACCEPTED and is
// held Open by the verifier until its submissions are re-pointed at the
// successor. Nothing here runs a gate; verify.mjs stays the only judge.
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { loadProject } from './lib.mjs';

const USAGE = 'usage: node tools/deprecate.mjs <contract> --reason <text> [--dir <project>]';
const LOG_REL = 'laws/deprecations.log';
const LOG_HEADER = '# append-only — one line per deprecated contract: <contract-name> <reason>\n';

// Every failure names what went wrong and what to do instead, and happens
// before the log is touched: a refused deprecation leaves the project byte-identical.
function fail(cause, remedy) {
  console.error(`deprecate: ${cause}`);
  if (remedy) console.error(`  ${remedy}`);
  process.exit(1);
}

function parseArgs(argv) {
  const names = [];
  let reason = null;
  let dir = '.';
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') {
      console.log(USAGE);
      process.exit(0);
    } else if (a === '--reason' || a === '--dir') {
      const value = argv[++i];
      if (value === undefined || value.startsWith('--')) fail(`${a} was given without a value`, USAGE);
      if (a === '--reason') reason = value;
      else dir = value;
    } else if (a.startsWith('-')) {
      fail(`unknown option "${a}"`, USAGE);
    } else {
      names.push(a);
    }
  }
  return { names, reason, dir };
}

const { names, reason, dir } = parseArgs(process.argv.slice(2));

if (names.length === 0) fail('no contract name given', USAGE);
if (names.length > 1) {
  fail(`expected one contract name but got ${names.length}: ${names.join(', ')}`,
    'quote a multi-word reason so it stays one argument: --reason "superseded by add2"');
}
const name = names[0];

if (reason === null) {
  fail('--reason <text> is required',
    'the log line is the only record of why a contract was retired: --reason "superseded by add2"');
}
// The log is line-oriented (<name> <reason>), so a reason spanning lines would
// read back as a second, bogus deprecation entry.
const reasonLine = reason.replace(/\s+/g, ' ').trim();
if (reasonLine === '') fail('--reason is blank', 'record the actual cause, e.g. --reason "superseded by add2"');

const root = path.resolve(dir);
if (!fs.existsSync(path.join(root, 'contracts'))) {
  fail(`no contracts/ directory under ${root}`,
    'point --dir at a build2me project root — the directory holding contracts/, impl/ and laws/');
}

const project = loadProject(root);
if (!project.contracts.has(name)) {
  const known = [...project.contracts.keys()].sort();
  const shown = known.slice(0, 10).join(', ') + (known.length > 10 ? `, … (${known.length} total)` : '');
  fail(`no contract named "${name}": contracts/${name}.json does not exist`,
    `only a published contract can be deprecated; known contracts: ${shown}`);
}

const logPath = path.join(root, 'laws', 'deprecations.log');
const existing = fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8') : '';
if (project.deprecated.has(name)) {
  const lines = existing.split('\n');
  const at = lines.findIndex((l) => l.trim().split(/\s+/)[0] === name);
  const where = at === -1 ? LOG_REL : `${LOG_REL}:${at + 1}: ${lines[at].trim()}`;
  fail(`contract "${name}" is already deprecated (${where})`,
    'the log is append-only and a contract is retired exactly once; to revise the decision, publish a successor contract and re-point its dependents at it');
}

// The reverse cascade, by breadth-first search over reverse import edges. A
// dependent that is itself already deprecated can never re-open, so it neither
// counts nor propagates.
const importersOf = (target) =>
  project.submissions.filter((s) => s.contract !== target && s.imports.includes(target));

const dependents = [];
const seen = new Set([name]);
let wave = [name];
while (wave.length > 0) {
  const next = [];
  for (const target of wave) {
    for (const s of importersOf(target)) {
      if (seen.has(s.contract) || project.deprecated.has(s.contract)) continue;
      seen.add(s.contract);
      dependents.push({ name: s.contract, via: s.key, imported: target });
      next.push(s.contract);
    }
  }
  wave = next;
}

// O_APPEND, one write: racing agents may deprecate at the same moment and
// neither line is lost or rewritten (law L3, append-only).
fs.mkdirSync(path.dirname(logPath), { recursive: true });
if (existing === '') fs.appendFileSync(logPath, LOG_HEADER);
const gap = existing === '' || existing.endsWith('\n') ? '' : '\n';
fs.appendFileSync(logPath, `${gap}${name} ${reasonLine}\n`);

console.log(`deprecated  ${name}`);
console.log(`reason      ${reasonLine}`);
console.log(`logged      ${LOG_REL}`);
console.log('');
if (dependents.length === 0) {
  console.log(`no dependent contracts: no submission imports ${name}.`);
} else {
  console.log(`${dependents.length} dependent contract${dependents.length === 1 ? '' : 's'} held Open until re-pointed at a successor:`);
  for (const d of dependents) console.log(`  ${d.name.padEnd(28)} ${d.via} imports ${d.imported}`);
  console.log('');
  console.log('re-point those submissions at a successor contract, then re-run node tools/verify.mjs.');
}
