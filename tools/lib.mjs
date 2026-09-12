// Shared engine: project loading and status derivation.
// Status is derived at read time, never stored (a contract file carries no
// status field) — the same rule prove2me applies to milestone completion.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const CONTRACT_FIELDS = ['name', 'title', 'interface', 'acceptance', 'nl_description', 'env'];
const SUBMISSION_KINDS = ['implementation', 'decomposition'];

export function loadProject(dir) {
  const errors = [];
  const contracts = new Map();

  const cdir = path.join(dir, 'contracts');
  if (!fs.existsSync(cdir)) {
    errors.push(`no contracts/ directory in ${dir}`);
    return { dir, contracts, submissions: [], laws: [], deprecated: new Set(), successors: new Map(), errors };
  }
  for (const file of fs.readdirSync(cdir).filter((f) => f.endsWith('.json')).sort()) {
    let c;
    try {
      c = JSON.parse(fs.readFileSync(path.join(cdir, file), 'utf8'));
    } catch (e) {
      errors.push(`contracts/${file}: invalid JSON (${e.message})`);
      continue;
    }
    for (const f of CONTRACT_FIELDS) {
      if (typeof c[f] !== 'string' || c[f].trim() === '') {
        if (!(f === 'env' && typeof c[f] === 'string')) errors.push(`contracts/${file}: missing or empty field "${f}"`);
      }
    }
    if (c.name !== path.basename(file, '.json')) {
      errors.push(`contracts/${file}: name "${c.name}" must match file name`);
    }
    if (contracts.has(c.name)) errors.push(`duplicate contract name "${c.name}"`);
    contracts.set(c.name, c);
  }

  const submissions = [];
  const idir = path.join(dir, 'impl');
  if (fs.existsSync(idir)) {
    for (const cname of fs.readdirSync(idir).sort()) {
      const cpath = path.join(idir, cname);
      if (!fs.statSync(cpath).isDirectory()) continue;
      for (const id of fs.readdirSync(cpath).sort()) {
        const mfile = path.join(cpath, id, 'meta.json');
        if (!fs.existsSync(mfile)) continue;
        let m;
        try {
          m = JSON.parse(fs.readFileSync(mfile, 'utf8'));
        } catch (e) {
          errors.push(`impl/${cname}/${id}/meta.json: invalid JSON (${e.message})`);
          continue;
        }
        const key = `${cname}/${id}`;
        if (m.contract !== cname) errors.push(`${key}: meta contract "${m.contract}" must match directory "${cname}"`);
        if (!SUBMISSION_KINDS.includes(m.kind)) errors.push(`${key}: kind must be one of ${SUBMISSION_KINDS.join(', ')}`);
        if (!Array.isArray(m.imports)) errors.push(`${key}: imports must be an array`);
        if (!Array.isArray(m.files)) errors.push(`${key}: files must be an array`);
        if (!contracts.has(cname)) errors.push(`${key}: unknown contract "${cname}"`);
        for (const imp of m.imports ?? []) {
          if (!contracts.has(imp)) errors.push(`${key}: unknown import "${imp}"`);
          if (imp === cname) errors.push(`${key}: self-import is forbidden (would close the contract from itself)`);
        }
        for (const f of m.files ?? []) {
          if (!fs.existsSync(path.join(dir, f))) errors.push(`${key}: listed file "${f}" does not exist`);
        }
        submissions.push({ key, contract: cname, id, kind: m.kind, imports: m.imports ?? [], files: m.files ?? [], notes: m.notes ?? '' });
      }
    }
  }

  const laws = [];
  const ldir = path.join(dir, 'laws');
  if (fs.existsSync(ldir)) {
    for (const file of fs.readdirSync(ldir).filter((f) => f.endsWith('.json')).sort()) {
      let l;
      try {
        l = JSON.parse(fs.readFileSync(path.join(ldir, file), 'utf8'));
      } catch (e) {
        errors.push(`laws/${file}: invalid JSON (${e.message})`);
        continue;
      }
      for (const f of ['id', 'dimension', 'statement', 'check']) {
        if (typeof l[f] !== 'string' || l[f].trim() === '') errors.push(`laws/${file}: missing or empty field "${f}"`);
      }
      if (l.id !== path.basename(file, '.json')) {
        errors.push(`laws/${file}: id "${l.id}" must match file name`);
      }
      laws.push(l);
    }
  }

  // A log line is `<name> <reason...>`; a `superseded-by:<successor>` token in
  // the reason is the machine-readable pointer revision leaves behind, so the
  // reopened downstream can be routed to the replacement (see tools/revise.mjs).
  const deprecated = new Set();
  const successors = new Map();
  const dfile = path.join(dir, 'laws', 'deprecations.log');
  if (fs.existsSync(dfile)) {
    for (const line of fs.readFileSync(dfile, 'utf8').split('\n')) {
      const t = line.trim();
      if (t === '' || t.startsWith('#')) continue;
      const [name, ...rest] = t.split(/\s+/);
      deprecated.add(name);
      const pointer = rest.find((w) => w.startsWith('superseded-by:'))?.slice('superseded-by:'.length);
      if (pointer && !successors.has(name)) successors.set(name, pointer);
    }
  }

  return { dir, contracts, submissions, laws, deprecated, successors, errors };
}

function findCycle(project) {
  // Union of decomposition edges (parent -> import) must be acyclic.
  const edges = new Map();
  for (const s of project.submissions) {
    if (!edges.has(s.contract)) edges.set(s.contract, new Set());
    for (const imp of s.imports) edges.get(s.contract).add(imp);
  }
  const state = new Map(); // 0 visiting, 1 done
  const stack = [];
  const visit = (n) => {
    if (state.get(n) === 1) return null;
    if (state.get(n) === 0) return [...stack.slice(stack.indexOf(n)), n];
    state.set(n, 0);
    stack.push(n);
    for (const next of edges.get(n) ?? []) {
      const cyc = visit(next);
      if (cyc) return cyc;
    }
    stack.pop();
    state.set(n, 1);
    return null;
  };
  for (const n of edges.keys()) {
    const cyc = visit(n);
    if (cyc) return cyc;
  }
  return null;
}

// Derives every contract's status by fixpoint.
//  - A submission whose imports are all Done triggers the CONTRACT's acceptance
//    gate; if the gate passes, the submission is ACCEPTED and the contract Done.
//  - Ancestors auto-resolve in later iterations: the cascade.
//  - With runAcceptance:false, gates are assumed green (structural mode) —
//    used for closability estimates, never for verdicts.
export function computeStatus(project, opts = {}) {
  const { runAcceptance = true, forceDone = new Set(), timeoutMs = 120000 } = opts;
  const errors = [];
  const cyc = findCycle(project);
  if (cyc) errors.push(`dependency cycle: ${cyc.join(' -> ')}`);

  const status = new Map();
  for (const name of project.contracts.keys()) {
    status.set(name, project.deprecated.has(name) ? 'deprecated' : forceDone.has(name) ? 'done' : 'open');
  }

  const gates = new Map();
  const gateEnv = sanitizedEnv();
  const gateOf = (name) => {
    if (!runAcceptance) return { ok: true, skipped: true };
    if (gates.has(name)) return gates.get(name);
    const cmd = project.contracts.get(name).acceptance;
    const r = spawnSync(cmd, { cwd: project.dir, shell: true, encoding: 'utf8', timeout: timeoutMs, env: gateEnv });
    const g = { ok: r.status === 0, output: `${r.stdout ?? ''}${r.stderr ?? ''}` };
    gates.set(name, g);
    return g;
  };

  const verdicts = new Map();
  if (!cyc) {
    let changed = true;
    while (changed) {
      changed = false;
      for (const s of project.submissions) {
        if (status.get(s.contract) !== 'open') continue;
        if (!s.imports.every((i) => status.get(i) === 'done')) {
          verdicts.set(s.key, 'SKETCH_ACCEPTED');
          continue;
        }
        const g = gateOf(s.contract);
        if (g.ok) {
          verdicts.set(s.key, 'ACCEPTED');
          status.set(s.contract, 'done');
          changed = true;
        } else {
          verdicts.set(s.key, 'GATE_FAILED');
        }
      }
    }
  }

  return { status, verdicts, gates, errors: [...project.errors, ...errors] };
}

// Gates and law checks must run in a sanitized environment: an outer
// `node --test` exports NODE_TEST_CONTEXT, and a nested test runner
// inheriting it exits 0 even on failure — a check that can be fooled is
// no check.
function sanitizedEnv() {
  return Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('NODE_TEST_')));
}

// Laws: the project's enforced floors, one per quality dimension.
//  - Built-in L1 (zero runtime dependencies) is part of the kernel.
//  - Declared laws (laws/<id>.json) each carry a check command, run from the
//    project root exactly like an acceptance gate. A law's check must never
//    invoke the verifier: verify runs the laws, so that would re-enter.
// Built-in law L1: tools must have zero runtime dependencies.
export function checkLaws(project) {
  const errors = [];
  const pkg = path.join(project.dir, 'package.json');
  if (fs.existsSync(pkg)) {
    try {
      const p = JSON.parse(fs.readFileSync(pkg, 'utf8'));
      if (p.dependencies && Object.keys(p.dependencies).length > 0) {
        errors.push(`law L1 violated: package.json declares runtime dependencies (${Object.keys(p.dependencies).join(', ')})`);
      }
    } catch (e) {
      errors.push(`package.json: invalid JSON (${e.message})`);
    }
  }
  for (const l of project.laws ?? []) {
    if (['id', 'dimension', 'statement', 'check'].some((f) => typeof l[f] !== 'string' || l[f].trim() === '')) continue; // already a structural error
    const r = spawnSync(l.check, { cwd: project.dir, shell: true, encoding: 'utf8', timeout: 120000, env: sanitizedEnv() });
    if (r.status !== 0) {
      const detail = `${r.stdout ?? ''}${r.stderr ?? ''}`.trim();
      errors.push(`law ${l.id} (${l.dimension}) violated: ${l.statement}${detail ? `\n${detail}` : ''}`);
    }
  }
  return errors;
}
