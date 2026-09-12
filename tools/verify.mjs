#!/usr/bin/env node
// The kernel analogue: derives every contract's status and every submission's
// verdict, and exits non-zero on structural errors, law violations, or a
// failing acceptance gate. Merged main must always verify green; failed
// attempts live on branches, where they stay searchable.
import path from 'node:path';
import process from 'node:process';
import { loadProject, computeStatus, checkLaws } from './lib.mjs';

const args = process.argv.slice(2);
const json = args.includes('--json');
const dirIdx = args.indexOf('--dir');
const dir = path.resolve(dirIdx === -1 ? '.' : args[dirIdx + 1]);

const project = loadProject(dir);
const { status, verdicts, gates, errors } = computeStatus(project);
const lawErrors = checkLaws(project);
const allErrors = [...errors, ...lawErrors];
const gateFailures = [...verdicts.entries()].filter(([, v]) => v === 'GATE_FAILED');

if (json) {
  console.log(JSON.stringify({
    dir,
    status: Object.fromEntries([...status.entries()].sort()),
    successors: Object.fromEntries([...project.successors.entries()].sort()),
    verdicts: Object.fromEntries([...verdicts.entries()].sort()),
    errors: allErrors,
  }, null, 2));
} else {
  const names = [...status.keys()].sort();
  console.log(`build2me verify — ${dir}\n`);
  for (const name of names) {
    const succ = status.get(name) === 'deprecated' && project.successors.has(name)
      ? ` -> superseded by ${project.successors.get(name)}` : '';
    console.log(`  ${name.padEnd(28)} ${status.get(name).toUpperCase()}${succ}`);
    for (const s of project.submissions.filter((x) => x.contract === name)) {
      const v = verdicts.get(s.key) ?? 'PENDING';
      console.log(`    ${('' + s.id).padEnd(26)} ${s.kind} -> ${v}`);
    }
  }
  const counts = ['done', 'open', 'deprecated'].map((k) => `${[...status.values()].filter((v) => v === k).length} ${k}`).join(', ');
  console.log(`\n  ${counts}`);
  for (const [key] of gateFailures) {
    console.log(`\nGATE_FAILED ${key}:\n${gates.get(project.submissions.find((s) => s.key === key).contract)?.output ?? ''}`);
  }
  for (const e of allErrors) console.log(`ERROR: ${e}`);
}

process.exit(allErrors.length > 0 || gateFailures.length > 0 ? 1 : 0);
