#!/usr/bin/env node
// The coordination server: the git-native flow (branch, PR, CI) exposed as an
// HTTP API, so a swarm of agents can publish contracts, submit attempts and
// read the frontier without a merge bottleneck.
//
// Status, verdicts and the cascade come from tools/lib.mjs; /api/frontier and
// /api/graph delegate to tools/frontier.mjs and tools/graph.mjs, so their
// numbers are the same numbers by construction rather than by agreement.
//
// v0.1 is the synchronous core. Deliberately NOT built here, so their absence
// is a scope decision and not an oversight:
//   - async verify queue. POST /api/submissions answers from a verification
//     pass run inline, holding the connection for as long as the gates take.
//     The prove2me shape is a job id plus verdict polling; every gate here
//     would then move behind it.
//   - accounts, auth, per-account in-flight caps. Every caller is anonymous,
//     so there is nothing to cap and nothing to authenticate; the immutability
//     rules below are the only thing protecting published work.
//   - multi-project serving. --dir fixes THE one project; a hosted instance
//     would route /p/<project>/api/... across many.
//
// API:
//   GET  /api/contracts            every contract with its derived status
//   GET  /api/contracts/<name>     one contract, its submissions and verdicts
//   POST /api/contracts            publish contracts/<name>.json (409 if taken)
//   POST /api/submissions          write impl/<contract>/<id>/meta.json, answer
//                                  with the verdict of a fresh pass
//   GET  /api/frontier             actionable contracts ranked by closability
//   GET  /api/graph                the contract DAG
//   GET  /api/search?q=            substring hits over contracts AND submissions
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadProject, computeStatus } from './lib.mjs';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(name);
  return i === -1 || args[i + 1] === undefined ? fallback : args[i + 1];
};
const dir = path.resolve(flag('--dir', '.'));
const host = flag('--host', '127.0.0.1');
const port = Number(flag('--port', '8787'));
const toolsDir = path.dirname(fileURLToPath(import.meta.url));

const CONTRACT_FIELDS = ['name', 'title', 'interface', 'acceptance', 'nl_description', 'env'];
const SUBMISSION_KINDS = ['implementation', 'decomposition'];
// A name is written into a path, so it must be one bare file-name token.
const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const ROUTES_HELP = 'the API is GET /api/contracts, POST /api/contracts, GET /api/contracts/<name>, POST /api/submissions, GET /api/frontier, GET /api/graph, GET /api/search?q=';
const BODY_LIMIT = 1_000_000;

const json = (res, code, body, headers = {}) => {
  const payload = `${JSON.stringify(body, null, 2)}\n`;
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(payload), ...headers });
  res.end(payload);
};
// Every error names the real cause and the concrete remedy: the caller is an
// agent that must self-correct without reading this file.
const fail = (res, code, error, remedy, headers) => json(res, code, { error, remedy }, headers);

const readJson = (req) => new Promise((resolve, reject) => {
  let raw = '';
  req.on('data', (chunk) => {
    raw += chunk;
    if (raw.length > BODY_LIMIT) {
      req.destroy();
      reject(new Error(`request body exceeds ${BODY_LIMIT} bytes`));
    }
  });
  req.on('end', () => {
    if (raw.trim() === '') return resolve({});
    try {
      resolve(JSON.parse(raw));
    } catch (e) {
      reject(new Error(`invalid JSON body (${e.message})`));
    }
  });
  req.on('error', reject);
});

const contractView = (c, status) => ({ ...c, serves: c.serves ?? null, status: status.get(c.name) });
const submissionView = (s, verdicts) => ({
  key: s.key,
  contract: s.contract,
  id: s.id,
  kind: s.kind,
  imports: s.imports,
  files: s.files,
  notes: s.notes,
  verdict: verdicts.get(s.key) ?? 'PENDING',
});

function listContracts(res) {
  const project = loadProject(dir);
  const { status } = computeStatus(project);
  const contracts = [...project.contracts.values()]
    .map((c) => contractView(c, status))
    .sort((a, b) => a.name.localeCompare(b.name));
  json(res, 200, { dir, contracts });
}

function getContract(res, [name]) {
  const project = loadProject(dir);
  if (!project.contracts.has(name)) {
    return fail(res, 404, `unknown contract "${name}"`, `list the published contracts with GET /api/contracts, or publish this one with POST /api/contracts (${ROUTES_HELP})`);
  }
  const { status, verdicts } = computeStatus(project);
  json(res, 200, {
    ...contractView(project.contracts.get(name), status),
    submissions: project.submissions.filter((s) => s.contract === name).map((s) => submissionView(s, verdicts)),
  });
}

function publishContract(res, _params, body) {
  const allowed = [...CONTRACT_FIELDS, 'serves'];
  const unknown = Object.keys(body).filter((k) => !allowed.includes(k));
  if (unknown.length > 0) {
    return fail(res, 400, `unknown contract field(s): ${unknown.join(', ')}`, `a contract carries exactly ${allowed.join(', ')} — status is derived by the verifier, never stored`);
  }
  const missing = CONTRACT_FIELDS.filter((f) => typeof body[f] !== 'string' || body[f].trim() === '');
  if (missing.length > 0) {
    return fail(res, 400, `missing or empty contract field(s): ${missing.join(', ')}`, `send every field: ${allowed.join(', ')}; "serves" may be null for a root contract`);
  }
  if (!NAME.test(body.name)) {
    return fail(res, 400, `contract name "${body.name}" is not a bare name token`, 'the name becomes contracts/<name>.json: use letters, digits, dot, dash or underscore, and no path separators');
  }
  if (body.serves !== undefined && body.serves !== null && typeof body.serves !== 'string') {
    return fail(res, 400, '"serves" must be a contract name or null', 'point it at the higher contract this one exists for, or send null for a root contract');
  }

  const contract = {
    name: body.name,
    title: body.title,
    interface: body.interface,
    acceptance: body.acceptance,
    nl_description: body.nl_description,
    serves: body.serves ?? null,
    env: body.env,
  };
  const file = path.join(dir, 'contracts', `${contract.name}.json`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  try {
    // wx, not a read-then-write check: two agents publishing one name race, and
    // the loser must be told, not silently overwrite a published contract.
    fs.writeFileSync(file, `${JSON.stringify(contract, null, 2)}\n`, { flag: 'wx' });
  } catch (e) {
    if (e.code !== 'EEXIST') throw e;
    return fail(res, 409, `contract "${contract.name}" already exists and contracts are immutable (law L2)`, `never edit a published contract: deprecate it by appending "${contract.name} <reason>" to laws/deprecations.log, then supersede it with a successor published under a new name`);
  }
  json(res, 201, { name: contract.name, file: `contracts/${contract.name}.json` }, { location: `/api/contracts/${contract.name}` });
}

// The next free sub-NNN for a contract; explicit ids are never reused.
function nextSubmissionId(contract) {
  const cdir = path.join(dir, 'impl', contract);
  const used = fs.existsSync(cdir) ? fs.readdirSync(cdir) : [];
  const highest = used.reduce((max, name) => {
    const m = name.match(/^sub-(\d+)$/);
    return m ? Math.max(max, Number(m[1])) : max;
  }, 0);
  return `sub-${String(highest + 1).padStart(3, '0')}`;
}

function createSubmission(res, _params, body) {
  if (typeof body.contract !== 'string' || body.contract.trim() === '') {
    return fail(res, 400, 'missing "contract": a submission must name its target', 'send {contract, kind, imports, files, notes} — pick the target from GET /api/frontier');
  }
  const project = loadProject(dir);
  if (!project.contracts.has(body.contract)) {
    return fail(res, 404, `unknown contract "${body.contract}"`, 'publish it first with POST /api/contracts, or pick an existing target from GET /api/contracts');
  }
  if (!SUBMISSION_KINDS.includes(body.kind)) {
    return fail(res, 400, `kind "${body.kind}" is neither implementation nor decomposition`, 'use "implementation" (does the work) or "decomposition" (reduces the contract to the children it imports)');
  }
  for (const [field, value] of [['imports', body.imports], ['files', body.files]]) {
    if (value !== undefined && (!Array.isArray(value) || value.some((x) => typeof x !== 'string'))) {
      return fail(res, 400, `"${field}" must be an array of strings`, `send ${field}: [] when there are none`);
    }
  }
  if (body.notes !== undefined && typeof body.notes !== 'string') {
    return fail(res, 400, '"notes" must be a string', 'record the approach and the dead ends — notes are what the next agent searches');
  }
  const imports = body.imports ?? [];
  const files = body.files ?? [];
  for (const imp of imports) {
    if (imp === body.contract) {
      return fail(res, 400, `self-import is forbidden: "${imp}" would close the contract from itself`, 'import the children this submission builds against, never the target itself');
    }
    if (!project.contracts.has(imp)) {
      return fail(res, 400, `unknown import "${imp}"`, 'every import must be a published contract: search GET /api/search?q= for the one you mean, or publish it with POST /api/contracts');
    }
  }
  for (const f of files) {
    const resolved = path.resolve(dir, f);
    if (path.isAbsolute(f) || (resolved !== dir && !resolved.startsWith(dir + path.sep))) {
      return fail(res, 400, `listed file "${f}" is outside the project directory`, 'list project-relative paths only, such as "tools/serve.mjs"');
    }
    if (!fs.existsSync(resolved)) {
      return fail(res, 400, `listed file "${f}" does not exist in the project`, 'write the artifact into the project directory first: a submission records paths, it does not carry content');
    }
  }
  if (body.id !== undefined && !NAME.test(String(body.id))) {
    return fail(res, 400, `submission id "${body.id}" is not a bare name token`, 'omit "id" to be given the next free sub-NNN, or use letters, digits, dot, dash or underscore');
  }

  const id = body.id ?? nextSubmissionId(body.contract);
  const sdir = path.join(dir, 'impl', body.contract, id);
  fs.mkdirSync(path.dirname(sdir), { recursive: true });
  try {
    // Non-recursive on purpose: EEXIST is the immutability check.
    fs.mkdirSync(sdir);
  } catch (e) {
    if (e.code !== 'EEXIST') throw e;
    return fail(res, 409, `submission "${body.contract}/${id}" already exists and submissions are immutable`, 'supersede it instead: submit again without an "id" and you are given the next free sub-NNN');
  }
  const meta = { contract: body.contract, kind: body.kind, imports, files, notes: body.notes ?? '' };
  fs.writeFileSync(path.join(sdir, 'meta.json'), `${JSON.stringify(meta, null, 2)}\n`, { flag: 'wx' });

  // The verdict comes from a fresh pass over the project as it now stands —
  // including the cascade this submission may have triggered upward.
  const fresh = computeStatus(loadProject(dir));
  const key = `${body.contract}/${id}`;
  json(res, 201, {
    ...meta,
    id,
    key,
    verdict: fresh.verdicts.get(key) ?? 'PENDING',
    status: fresh.status.get(body.contract),
    errors: fresh.errors,
  }, { location: `/api/contracts/${body.contract}` });
}

// Failed and superseded submissions are included on purpose: in this protocol
// they are assets, and finding them is what stops the next agent repeating them.
function search(res, url) {
  const q = url.searchParams.get('q') ?? '';
  if (q.trim() === '') {
    return fail(res, 400, 'missing query parameter "q"', 'search with GET /api/search?q=<text>: a case-insensitive substring over contract name, title and nl_description, and over submission notes');
  }
  const needle = q.toLowerCase();
  const hit = (value) => String(value ?? '').toLowerCase().includes(needle);
  const project = loadProject(dir);
  const { status, verdicts } = computeStatus(project);
  json(res, 200, {
    dir,
    q,
    contracts: [...project.contracts.values()]
      .filter((c) => hit(c.name) || hit(c.title) || hit(c.nl_description))
      .map((c) => contractView(c, status))
      .sort((a, b) => a.name.localeCompare(b.name)),
    submissions: project.submissions.filter((s) => hit(s.notes)).map((s) => submissionView(s, verdicts)),
  });
}

function delegate(res, tool, extra) {
  const r = spawnSync(process.execPath, [path.join(toolsDir, tool), '--dir', dir, ...extra], { encoding: 'utf8', timeout: 300000 });
  if (r.status !== 0) {
    return fail(res, 500, `tools/${tool} failed for ${dir}: ${(r.stderr || r.stdout || '').trim()}`, `run "node tools/verify.mjs --dir ${dir}" and fix the structural errors it names`);
  }
  try {
    json(res, 200, JSON.parse(r.stdout));
  } catch (e) {
    fail(res, 500, `tools/${tool} produced output this server could not parse (${e.message})`, 'this is a server-side defect: report the project directory and the tool output');
  }
}

const routes = [
  { method: 'GET', pattern: /^\/api\/contracts$/, handler: (res) => listContracts(res) },
  { method: 'POST', pattern: /^\/api\/contracts$/, body: true, handler: (res, params, body) => publishContract(res, params, body) },
  { method: 'GET', pattern: /^\/api\/contracts\/([^/]+)$/, handler: (res, params) => getContract(res, params) },
  { method: 'POST', pattern: /^\/api\/submissions$/, body: true, handler: (res, params, body) => createSubmission(res, params, body) },
  { method: 'GET', pattern: /^\/api\/frontier$/, handler: (res) => delegate(res, 'frontier.mjs', ['--json']) },
  { method: 'GET', pattern: /^\/api\/graph$/, handler: (res) => delegate(res, 'graph.mjs', ['--format', 'json']) },
  { method: 'GET', pattern: /^\/api\/search$/, handler: (res, params, body, url) => search(res, url) },
];

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host ?? host}`);
    const pathname = url.pathname.length > 1 ? url.pathname.replace(/\/+$/, '') : url.pathname;
    const onPath = routes.filter((r) => r.pattern.test(pathname));
    if (onPath.length === 0) {
      return fail(res, 404, `unknown route ${req.method} ${pathname}`, ROUTES_HELP);
    }
    const route = onPath.find((r) => r.method === req.method);
    if (!route) {
      const allow = [...new Set(onPath.map((r) => r.method))].join(', ');
      return fail(res, 405, `${req.method} is not allowed on ${pathname}`, `use ${allow}: contracts and submissions are immutable, so nothing here is edited or deleted`, { allow });
    }
    const params = pathname.match(route.pattern).slice(1).map(decodeURIComponent);
    let body = null;
    if (route.body) {
      try {
        body = await readJson(req);
      } catch (e) {
        return fail(res, 400, e.message, 'send a JSON object body with content-type: application/json');
      }
      if (body === null || typeof body !== 'object' || Array.isArray(body)) {
        return fail(res, 400, 'request body must be a JSON object', 'send the fields as one object, not an array or a bare value');
      }
    }
    route.handler(res, params, body, url);
  } catch (e) {
    fail(res, 500, `server error handling ${req.method} ${req.url}: ${e.message}`, `check that ${dir} is a readable build2me project and run "node tools/verify.mjs --dir ${dir}"`);
  }
});

if (!fs.existsSync(path.join(dir, 'contracts'))) {
  console.error(`no contracts/ directory in ${dir} — serve a build2me project root, or pass --dir <project>`);
  process.exit(1);
}
if (!Number.isInteger(port) || port < 0 || port > 65535) {
  console.error(`invalid --port "${flag('--port', '')}" — use a port number, or 0 to bind an ephemeral one`);
  process.exit(1);
}
server.on('error', (e) => {
  console.error(`cannot listen on ${host}:${port} — ${e.message}`);
  process.exit(1);
});
server.listen(port, host, () => {
  console.log(`build2me serve — ${dir}`);
  console.log(`  listening on http://${host}:${server.address().port}`);
});
