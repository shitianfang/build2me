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
    if (subs.length === 0) return true;
    if (subs.some((s) => s.imports.every((i) => status.get(i) === 'done'))) return true;
    // Reopened by deprecation: when every submission imports at least one
    // deprecated contract, no cascade will ever close this contract — waiting
    // is pointless, so the repair (re-point at the successor) is actionable
    // now. A contract with even one deprecation-free submission still has a
    // live path and stays off the frontier; its open children are on it.
    return subs.every((s) => s.imports.some((i) => status.get(i) === 'deprecated'));
  });

// For a reopened contract, name each deprecated import and where it went.
const repairsOf = (name) => {
  const seen = new Map();
  for (const s of subsOf(name)) {
    for (const i of s.imports) {
      if (status.get(i) === 'deprecated' && !seen.has(i)) seen.set(i, project.successors.get(i) ?? null);
    }
  }
  return [...seen.entries()].map(([imp, succ]) => ({ import: imp, successor: succ }));
};

const doneSet = (res) => new Set([...res.status.entries()].filter(([, v]) => v === 'done').map(([k]) => k));
const base = doneSet(computeStatus(project, { runAcceptance: false }));
const rows = leaves.map((name) => {
  const hyp = doneSet(computeStatus(project, { runAcceptance: false, forceDone: new Set([name]) }));
  const closability = [...hyp].filter((n) => n !== name && !base.has(n)).length;
  const repairs = repairsOf(name);
  return { name, closability, title: project.contracts.get(name).title, ...(repairs.length > 0 ? { repairs } : {}) };
}).sort((a, b) => b.closability - a.closability || a.name.localeCompare(b.name));

if (json) {
  console.log(JSON.stringify({ dir, open: rows }, null, 2));
} else {
  console.log(`build2me frontier — ${dir}\n`);
  if (rows.length === 0) {
    console.log('  (empty — every contract is Done or Deprecated)');
  } else {
    console.log(`  ${'closability'.padEnd(12)} contract`);
    for (const r of rows) {
      const hint = (r.repairs ?? [])
        .map((x) => `re-point ${x.import} -> ${x.successor ?? '(no successor yet — publish one)'}`).join(', ');
      console.log(`  ${String(r.closability).padEnd(12)} ${r.name.padEnd(28)} ${r.title}${hint ? `  [${hint}]` : ''}`);
    }
  }
}
