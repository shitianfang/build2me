#!/usr/bin/env node
// The scheduler: prints Open leaf contracts ranked by closability — how many
// ancestors would structurally auto-resolve if this leaf were Done. Agents
// pick work from this ranking; there are no locks and no assignments.
//
// A leaf is an Open contract that is actionable right now: it has no
// submissions at all (unstarted), or some submission's imports are all Done
// (its own gate is what stands in the way). Contracts whose only submissions
// still import Open children are not leaves — the children are.
//
// Closability is a structural upper bound: in the hypothetical, acceptance
// gates are assumed green.
import path from 'node:path';
import process from 'node:process';
import { loadProject, computeStatus } from './lib.mjs';

const args = process.argv.slice(2);
const json = args.includes('--json');
const structural = args.includes('--structural');
const dirIdx = args.indexOf('--dir');
const dir = path.resolve(dirIdx === -1 ? '.' : args[dirIdx + 1]);

const project = loadProject(dir);
const { status, errors } = computeStatus(project, { runAcceptance: !structural });
if (errors.length > 0) {
  for (const e of errors) console.error(`ERROR: ${e}`);
  process.exit(1);
}

const subsOf = (name) => project.submissions.filter((s) => s.contract === name);
const leaves = [...status.entries()]
  .filter(([name, st]) => st === 'open')
  .map(([name]) => name)
  .filter((name) => {
    const subs = subsOf(name);
    return subs.length === 0 || subs.some((s) => s.imports.every((i) => status.get(i) === 'done'));
  });

const doneSet = (res) => new Set([...res.status.entries()].filter(([, v]) => v === 'done').map(([k]) => k));
const base = doneSet(computeStatus(project, { runAcceptance: false }));
const rows = leaves.map((name) => {
  const hyp = doneSet(computeStatus(project, { runAcceptance: false, forceDone: new Set([name]) }));
  const closability = [...hyp].filter((n) => n !== name && !base.has(n)).length;
  return { name, closability, title: project.contracts.get(name).title };
}).sort((a, b) => b.closability - a.closability || a.name.localeCompare(b.name));

if (json) {
  console.log(JSON.stringify({ dir, open: rows }, null, 2));
} else {
  console.log(`build2me frontier — ${dir}\n`);
  if (rows.length === 0) {
    console.log('  (empty — every contract is Done or Deprecated)');
  } else {
    console.log(`  ${'closability'.padEnd(12)} contract`);
    for (const r of rows) console.log(`  ${String(r.closability).padEnd(12)} ${r.name.padEnd(28)} ${r.title}`);
  }
}
