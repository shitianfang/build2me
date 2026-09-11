#!/usr/bin/env node
// Cold-agent drill runner: bookkeeping for the standardized comprehension and
// bug-localization tasks a context-free agent is asked to solve against this
// repository. Files read and turns taken are the codebase-quality trend
// metric — when the decomposition degrades, a cold agent needs more of both.
//
// The agent is external. v0.1 makes no model calls: it defines the tasks,
// judges a reported attempt against them, and keeps the trend.
//
// drills/<id>.json
//   {
//     "id": "status-derivation",              // must equal the file name
//     "prompt": "<the question handed to a cold agent, verbatim>",
//     "expected": {                           // at least one of:
//       "files_to_find": ["tools/lib.mjs"],   //   every path must be reported
//       "answer_pattern": "computeStatus"     //   JS regex the answer must match
//     },
//     "budget": { "max_files_read": 4, "max_turns": 3 }   // optional ceilings
//   }
//
// drills/results.log is append-only, the same discipline as
// laws/deprecations.log: one JSON object per line, nothing ever rewritten.
//
// Usage:
//   drill.mjs list [--dir p] [--json]
//   drill.mjs record <drill-id> --files-read N --turns N [--found <paths...>]
//                    [--answer t] [--notes t] [--dir p]
//   drill.mjs report [--dir p] [--json]
//
// record exits non-zero when the attempt FAILs, so a runner's exit status
// carries the verdict; usage errors print ERROR: on stderr and append nothing.
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const RESULTS_HEADER = '# append-only — one JSON result per line: {ts, drill, result, files_read, turns, found, answer?, reasons, notes}\n';

const args = process.argv.slice(2);
const command = args[0] ?? '';
const json = args.includes('--json');
const fail = (msg) => {
  console.error(`ERROR: ${msg}`);
  process.exit(1);
};
const value = (flag) => {
  const i = args.indexOf(flag);
  if (i === -1) return null;
  const v = args[i + 1];
  if (v === undefined || v.startsWith('--')) fail(`${flag} requires a value`);
  return v;
};
const values = (flag) => {
  const i = args.indexOf(flag);
  if (i === -1) return [];
  const out = [];
  for (let j = i + 1; j < args.length && !args[j].startsWith('--'); j++) out.push(args[j]);
  return out;
};
const count = (flag) => {
  const v = value(flag);
  if (v === null) return null;
  if (!/^\d+$/.test(v)) fail(`${flag} must be a non-negative integer, got "${v}"`);
  return Number(v);
};

const dir = path.resolve(value('--dir') ?? '.');
const drillsDir = path.join(dir, 'drills');
const resultsFile = path.join(drillsDir, 'results.log');
const norm = (p) => p.trim().replace(/^\.\//, '').replace(/\/+$/, '');

const loadDrills = () => {
  if (!fs.existsSync(drillsDir)) {
    fail(`no drills/ directory in ${dir} — add drills/<id>.json (format: header of tools/drill.mjs)`);
  }
  const drills = [];
  for (const file of fs.readdirSync(drillsDir).filter((f) => f.endsWith('.json')).sort()) {
    let d;
    try {
      d = JSON.parse(fs.readFileSync(path.join(drillsDir, file), 'utf8'));
    } catch (e) {
      fail(`drills/${file}: invalid JSON (${e.message})`);
    }
    const id = path.basename(file, '.json');
    if (d.id !== id) fail(`drills/${file}: id "${d.id}" must match the file name`);
    if (typeof d.prompt !== 'string' || d.prompt.trim() === '') fail(`drills/${file}: missing or empty "prompt"`);
    const expected = d.expected ?? {};
    const budget = d.budget ?? {};
    if (!Array.isArray(expected.files_to_find) && typeof expected.answer_pattern !== 'string') {
      fail(`drills/${file}: "expected" must declare files_to_find and/or answer_pattern`);
    }
    if (typeof expected.answer_pattern === 'string') {
      try {
        new RegExp(expected.answer_pattern);
      } catch (e) {
        fail(`drills/${file}: answer_pattern is not a valid regex (${e.message})`);
      }
    }
    drills.push({ id, prompt: d.prompt, expected, budget, file: `drills/${file}` });
  }
  return drills;
};

const readResults = () => {
  if (!fs.existsSync(resultsFile)) return [];
  const out = [];
  const lines = fs.readFileSync(resultsFile, 'utf8').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (t === '' || t.startsWith('#')) continue;
    try {
      out.push(JSON.parse(t));
    } catch (e) {
      fail(`drills/results.log:${i + 1}: invalid result line (${e.message})`);
    }
  }
  return out;
};

// Every unmet expectation and every exceeded ceiling, named with its remedy.
const judge = (drill, attempt) => {
  const reasons = [];
  const found = attempt.found.map(norm);
  for (const want of drill.expected.files_to_find ?? []) {
    if (!found.includes(norm(want))) reasons.push(`expected file not reported: ${want}`);
  }
  if (typeof drill.expected.answer_pattern === 'string') {
    if (attempt.answer === null) {
      reasons.push(`this drill expects an answer matching /${drill.expected.answer_pattern}/ — pass --answer "<the agent's answer>"`);
    } else if (!new RegExp(drill.expected.answer_pattern).test(attempt.answer)) {
      reasons.push(`answer does not match /${drill.expected.answer_pattern}/`);
    }
  }
  const { max_files_read: maxFiles, max_turns: maxTurns } = drill.budget ?? {};
  if (typeof maxFiles === 'number' && attempt.files_read > maxFiles) {
    reasons.push(`over budget: ${attempt.files_read} files read, budget ${maxFiles}`);
  }
  if (typeof maxTurns === 'number' && attempt.turns > maxTurns) {
    reasons.push(`over budget: ${attempt.turns} turns, budget ${maxTurns}`);
  }
  return reasons;
};

const round2 = (n) => Math.round(n * 100) / 100;
const budgetText = (b) => {
  const parts = [];
  if (typeof b.max_files_read === 'number') parts.push(`${b.max_files_read} files`);
  if (typeof b.max_turns === 'number') parts.push(`${b.max_turns} turns`);
  return parts.length === 0 ? 'no budget' : parts.join(', ');
};

if (command === 'list') {
  const drills = loadDrills();
  if (json) {
    console.log(JSON.stringify({ dir, drills }, null, 2));
  } else {
    console.log(`build2me drills — ${dir}\n`);
    if (drills.length === 0) console.log('  (none — add drills/<id>.json)');
    for (const d of drills) {
      console.log(`  ${d.id}  (budget: ${budgetText(d.budget)})`);
      console.log(`    prompt: ${d.prompt}`);
      if (d.expected.files_to_find) console.log(`    expect files: ${d.expected.files_to_find.join(', ')}`);
      if (d.expected.answer_pattern) console.log(`    expect answer: /${d.expected.answer_pattern}/`);
      console.log('');
    }
  }
} else if (command === 'record') {
  const id = args[1];
  if (!id || id.startsWith('--')) fail('record requires a drill id: drill.mjs record <drill-id> --files-read N --turns N');
  const drills = loadDrills();
  const drill = drills.find((d) => d.id === id);
  if (!drill) fail(`unknown drill "${id}" — known drills: ${drills.map((d) => d.id).join(', ') || '(none)'}`);
  const filesRead = count('--files-read');
  const turns = count('--turns');
  if (filesRead === null || turns === null) fail(`recording "${id}" requires --files-read <n> and --turns <n> — they are the trend metric`);

  const attempt = {
    files_read: filesRead,
    turns,
    found: values('--found'),
    answer: value('--answer'),
    notes: value('--notes') ?? '',
  };
  const reasons = judge(drill, attempt);
  const result = reasons.length === 0 ? 'PASS' : 'FAIL';
  const line = {
    ts: new Date().toISOString(),
    drill: id,
    result,
    files_read: attempt.files_read,
    turns: attempt.turns,
    found: attempt.found,
    ...(attempt.answer === null ? {} : { answer: attempt.answer }),
    reasons,
    notes: attempt.notes,
  };
  if (!fs.existsSync(resultsFile)) fs.writeFileSync(resultsFile, RESULTS_HEADER);
  fs.appendFileSync(resultsFile, `${JSON.stringify(line)}\n`);

  console.log(`${result} ${id} — ${attempt.files_read} files read, ${attempt.turns} turns (budget: ${budgetText(drill.budget)})`);
  for (const r of reasons) console.log(`  - ${r}`);
  console.log('  recorded in drills/results.log');
  process.exit(result === 'PASS' ? 0 : 1);
} else if (command === 'report') {
  const drills = loadDrills();
  const results = readResults();
  const rows = drills.map((d) => {
    const mine = results.filter((r) => r.drill === d.id);
    const passes = mine.filter((r) => r.result === 'PASS').length;
    const avg = (key) => (mine.length === 0 ? null : round2(mine.reduce((s, r) => s + (r[key] ?? 0), 0) / mine.length));
    return {
      id: d.id,
      attempts: mine.length,
      passes,
      pass_rate: mine.length === 0 ? null : round2(passes / mine.length),
      avg_files_read: avg('files_read'),
      avg_turns: avg('turns'),
      first_files_read: mine.length === 0 ? null : mine[0].files_read,
      last_files_read: mine.length === 0 ? null : mine[mine.length - 1].files_read,
    };
  });
  const known = new Set(drills.map((d) => d.id));
  const unknown = [...results.filter((r) => !known.has(r.drill)).reduce((m, r) => m.set(r.drill, (m.get(r.drill) ?? 0) + 1), new Map())]
    .map(([id, attempts]) => ({ id, attempts }))
    .sort((a, b) => a.id.localeCompare(b.id));

  if (json) {
    console.log(JSON.stringify({ dir, drills: rows, unknown }, null, 2));
  } else {
    const show = (v, suffix = '') => (v === null ? '-' : `${v}${suffix}`);
    console.log(`build2me drill report — ${dir}\n`);
    console.log(`  ${'drill'.padEnd(28)}${'attempts'.padEnd(10)}${'pass'.padEnd(6)}${'rate'.padEnd(8)}${'avg files'.padEnd(12)}${'avg turns'.padEnd(12)}files first -> last`);
    for (const r of rows) {
      console.log(`  ${r.id.padEnd(28)}${String(r.attempts).padEnd(10)}${String(r.passes).padEnd(6)}`
        + `${show(r.pass_rate === null ? null : Math.round(r.pass_rate * 100), '%').padEnd(8)}`
        + `${show(r.avg_files_read).padEnd(12)}${show(r.avg_turns).padEnd(12)}`
        + `${r.attempts === 0 ? '-' : `${r.first_files_read} -> ${r.last_files_read}`}`);
    }
    for (const u of unknown) console.log(`\n  ${u.attempts} result(s) for retired drill "${u.id}" — kept, the log is append-only`);
  }
} else {
  fail('usage: drill.mjs list | record <drill-id> --files-read N --turns N [--found <paths...>] | report  [--dir p] [--json]');
}
