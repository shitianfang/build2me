#!/usr/bin/env node
// Revision: how a contract evolves. A contract is never edited in place — this
// tool performs the whole legal move as one operation:
//
//   1. publish the successor contract (predecessor's fields + your changes,
//      auto-named <base>-v2, -v3, ... unless --as says otherwise);
//   2. deprecate the predecessor (delegated to tools/deprecate.mjs, so every
//      log guard and the append-only invariant apply unchanged), recording a
//      machine-readable pointer:  <old> superseded-by:<new> <reason>
//
// Deprecation reopens everything downstream; the pointer gives that reopened
// work a destination — verify, graph and the frontier all read it, and the
// frontier lists each reopened dependent with the successor to re-point at.
// History is append-only throughout: the predecessor file, every submission
// ever made against it, and the log line all remain.
//
// Usage: node tools/revise.mjs <contract> --reason <text>
//          (--set field=value)... | --file <draft.json>
//          [--as <successor-name>] [--dir <project>]
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { loadProject } from './lib.mjs';

const USAGE = 'usage: node tools/revise.mjs <contract> --reason <text> (--set field=value)... | --file <draft.json> [--as <name>] [--dir <project>]';
const FIELDS = ['name', 'title', 'interface', 'acceptance', 'nl_description', 'serves', 'env'];
const SETTABLE = FIELDS.filter((f) => f !== 'name'); // the successor's name comes from --as or auto-numbering

// Every failure path exits before writing anything, so a refused revision
// leaves contracts/ and laws/deprecations.log byte-identical.
const fail = (message, ...hints) => {
  console.error(`revise: ${message}`);
  for (const hint of hints) console.error(`  ${hint}`);
  process.exit(1);
};

const argv = process.argv.slice(2);
const flags = { dir: '.', reason: null, as: null, file: null };
const sets = [];
const positional = [];
for (let i = 0; i < argv.length; i++) {
  const arg = argv[i];
  if (arg === '--help' || arg === '-h') {
    console.log(USAGE);
    process.exit(0);
  }
  const eq = arg.startsWith('--') ? arg.indexOf('=') : -1;
  const key = eq === -1 ? arg : arg.slice(0, eq);
  if (key === '--dir' || key === '--reason' || key === '--as' || key === '--file' || key === '--set') {
    const value = eq === -1 ? argv[++i] : arg.slice(eq + 1);
    if (value === undefined || (eq === -1 && value.startsWith('--'))) fail(`${key} needs a value`, USAGE);
    if (key === '--set') sets.push(value);
    else flags[key.slice(2)] = value;
  } else if (arg.startsWith('-') && arg !== '-') {
    fail(`unknown option "${arg}"`, USAGE);
  } else {
    positional.push(arg);
  }
}

if (positional.length !== 1) fail(`expected exactly one contract name, got ${positional.length}`, USAGE);
const oldName = positional[0];
if (flags.reason === null || flags.reason.replace(/\s+/g, ' ').trim() === '') {
  fail('--reason is required: a revision must record why, for the agent that finds it later', USAGE);
}
if (sets.length > 0 && flags.file !== null) fail('--set and --file are two ways to say the same thing — use one', USAGE);
if (sets.length === 0 && flags.file === null) {
  fail('a revision must change something: pass --set field=value (repeatable) or --file <draft.json>',
    `settable fields: ${SETTABLE.join(', ')}`);
}

const dir = path.resolve(flags.dir);
if (!fs.existsSync(path.join(dir, 'contracts'))) fail(`"${dir}" has no contracts/ directory, so it is not a build2me project root`, USAGE);
const contractFile = (name) => path.join(dir, 'contracts', `${name}.json`);

const project = loadProject(dir);
if (!project.contracts.has(oldName)) {
  fail(`unknown contract "${oldName}": contracts/${oldName}.json does not exist`,
    `known contracts: ${[...project.contracts.keys()].join(', ') || '(none)'}`);
}
if (project.deprecated.has(oldName)) {
  const succ = project.successors.get(oldName);
  fail(`"${oldName}" is already deprecated — a contract is revised at most once`,
    succ ? `its successor is "${succ}"; revise that instead` : 'publish or revise its successor instead');
}
const old = project.contracts.get(oldName);

// Build the successor: predecessor's fields plus the requested changes.
const successor = {};
for (const f of FIELDS) successor[f] = old[f] ?? (f === 'serves' ? null : '');
if (flags.file !== null) {
  const draftPath = path.resolve(flags.file);
  if (!fs.existsSync(draftPath)) fail(`draft file "${flags.file}" does not exist`);
  let draft;
  try {
    draft = JSON.parse(fs.readFileSync(draftPath, 'utf8'));
  } catch (e) {
    fail(`draft file "${flags.file}" is not valid JSON: ${e.message}`);
  }
  for (const f of SETTABLE) if (f in draft) successor[f] = draft[f];
  if (typeof draft.name === 'string' && draft.name !== '') {
    if (flags.as !== null && flags.as !== draft.name) fail(`--as "${flags.as}" contradicts the draft's name "${draft.name}"`);
    flags.as = draft.name;
  }
} else {
  for (const s of sets) {
    const eq = s.indexOf('=');
    if (eq === -1) fail(`--set expects field=value, got "${s}"`, `settable fields: ${SETTABLE.join(', ')}`);
    const field = s.slice(0, eq);
    if (!SETTABLE.includes(field)) fail(`"${field}" is not a contract field`, `settable fields: ${SETTABLE.join(', ')}`);
    const value = s.slice(eq + 1);
    successor[field] = field === 'serves' && value === 'null' ? null : value;
  }
}

// Successor name: --as, or auto-number the predecessor (add -> add-v2 -> add-v3).
let newName = flags.as;
if (newName === null) {
  const m = oldName.match(/^(.*)-v(\d+)$/);
  const base = m ? m[1] : oldName;
  for (let n = m ? Number(m[2]) + 1 : 2; ; n++) {
    const cand = `${base}-v${n}`;
    if (!project.contracts.has(cand) && !project.deprecated.has(cand) && !fs.existsSync(contractFile(cand))) {
      newName = cand;
      break;
    }
  }
}
if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(newName)) {
  fail(`successor name "${newName}" is not a legal contract name`, 'letters, digits, ".", "_", "-" only; it becomes a file name and a log token');
}
if (newName === oldName) fail('the successor must have a new name — contracts are never edited in place');
if (project.contracts.has(newName) || project.deprecated.has(newName) || fs.existsSync(contractFile(newName))) {
  fail(`successor name "${newName}" is already taken`, 'pick another with --as');
}
successor.name = newName;

for (const f of FIELDS) {
  const ok = f === 'serves' ? successor[f] === null || typeof successor[f] === 'string'
    : f === 'env' ? typeof successor[f] === 'string'
      : typeof successor[f] === 'string' && successor[f].trim() !== '';
  if (!ok) fail(`successor field "${f}" is missing or empty — a successor must be a complete contract`);
}
const changed = SETTABLE.filter((f) => (successor[f] ?? null) !== (old[f] ?? null));
if (changed.length === 0) {
  fail('this revision changes nothing — the successor would restate the predecessor field for field',
    'a revision exists to evolve the statement; change at least one field');
}

// 1. Publish the successor. A new contract on its own is harmless (just Open
//    work), so it goes first; if the deprecation below is refused, it is
//    removed again and nothing happened.
fs.writeFileSync(contractFile(newName), `${JSON.stringify(successor, null, 2)}\n`);

// 2. Deprecate the predecessor through the existing tool — one implementation
//    of "append to the log", with all its guards and its read-back check.
const reason = `superseded-by:${newName} ${flags.reason}`;
const dep = spawnSync('node', [path.join(path.dirname(fileURLToPath(import.meta.url)), 'deprecate.mjs'), oldName, '--reason', reason, '--dir', dir],
  { encoding: 'utf8', timeout: 60000 });
if (dep.status !== 0) {
  fs.unlinkSync(contractFile(newName));
  process.stderr.write(dep.stderr ?? '');
  fail(`deprecating "${oldName}" was refused — the successor file has been removed, nothing changed`);
}

// Read-back: the pointer must actually resolve, or agents get a dead end.
if (loadProject(dir).successors.get(oldName) !== newName) {
  console.error(`revise: FATAL — the log line did not register "${newName}" as the successor of "${oldName}"`);
  console.error('  inspect the last line of laws/deprecations.log');
  process.exit(2);
}

console.log(`revised ${oldName} -> ${newName} (changed: ${changed.join(', ')})`);
console.log(`  successor published: contracts/${newName}.json — Open, it needs its own submissions`);
process.stdout.write(dep.stdout ?? '');
console.log(`\nEach reopened submission above is repaired by a new submission importing ${newName};`);
console.log('node tools/frontier.mjs lists the reopened contracts with this hint.');
