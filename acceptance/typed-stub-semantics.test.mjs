// Fixed gate for the typed-stub-semantics contract: a contract's interface,
// materialized as a stub, must let a parent build and load before the child is
// implemented, fail loudly and name the contract when called, and carry the
// contract's env pin. Implementers must not modify this file.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const example = 'examples/typed-stub';

// A missing deliverable must fail as a named artifact, never as a raw ENOENT.
const artifact = (rel) => {
  const p = path.join(repoRoot, rel);
  assert.ok(fs.existsSync(p), `missing artifact: ${rel}`);
  return p;
};

const stub = (...args) =>
  spawnSync('node', [artifact('tools/stub.mjs'), ...args], { encoding: 'utf8', timeout: 60000 });

const tmpdir = (tag) => fs.mkdtempSync(path.join(os.tmpdir(), `b2m-stub-${tag}-`));

const CHILD = {
  name: 'demo-child',
  title: 'Gate fixture child',
  interface: 'Two functions.\n\n```stub\nexport function one(a: string): string;\nexport function two(a: number, b: number): number;\n```\n',
  acceptance: 'true',
  nl_description: 'Written by this gate into a temporary directory; never part of the repository.',
  serves: 'demo-parent',
  env: 'node>=20',
};

const fixtureProject = (over = {}) => {
  const contract = { ...CHILD, ...over };
  const dir = tmpdir('gen');
  fs.mkdirSync(path.join(dir, 'contracts'));
  fs.writeFileSync(path.join(dir, 'contracts', `${contract.name}.json`), JSON.stringify(contract, null, 2));
  return dir;
};

const exampleCopy = () => {
  const src = artifact(example);
  const dir = tmpdir('example');
  fs.cpSync(src, dir, { recursive: true });
  return dir;
};

const REQUIRED_SECTIONS = [
  '## The stub block',
  '## Generating stubs',
  '## Stub semantics',
  '## Env pinning',
  '## Worked example: TypeScript',
  '## Lifecycle',
];

test('STUBS.md specifies the convention, the generator, env pinning and a typed example', () => {
  const text = fs.readFileSync(artifact('STUBS.md'), 'utf8');
  for (const s of REQUIRED_SECTIONS) assert.ok(text.includes(`\n${s}`), `STUBS.md missing section: ${s}`);
  assert.match(text, /not implemented: <contract>\/<symbol>/);
  assert.match(text, /node tools\/stub\.mjs/);
});

test('materializes every declared symbol as a function that throws, naming contract and symbol', async () => {
  const dir = fixtureProject();
  const out = path.join(dir, 'stubs', 'demo-child.mjs');
  const r = stub('demo-child', '--dir', dir, '--out', out);
  assert.equal(r.status, 0, r.stdout + r.stderr);

  const mod = await import(pathToFileURL(out).href);
  assert.equal(typeof mod.one, 'function');
  assert.equal(typeof mod.two, 'function');
  assert.throws(() => mod.one('x'), { message: 'not implemented: demo-child/one' });
  assert.throws(() => mod.two(1, 2), { message: 'not implemented: demo-child/two' });
});

test('the stub carries its contract identity and env pin', async () => {
  const dir = fixtureProject();
  const out = path.join(dir, 'demo-child.mjs');
  const r = stub('demo-child', '--dir', dir, '--out', out);
  assert.equal(r.status, 0, r.stdout + r.stderr);

  const { __stub } = await import(pathToFileURL(out).href);
  assert.deepEqual(__stub, { contract: 'demo-child', env: 'node>=20', symbols: ['one', 'two'] });
});

test('a stub refuses to load when the running toolchain is behind its env pin', async () => {
  const dir = fixtureProject({ env: 'node>=99' });
  const out = path.join(dir, 'pinned.mjs');
  const r = stub('demo-child', '--dir', dir, '--out', out);
  assert.equal(r.status, 0, r.stdout + r.stderr);

  await assert.rejects(import(pathToFileURL(out).href), (e) => {
    assert.match(e.message, /node>=99/);
    assert.ok(e.message.includes(process.versions.node), `pin error must name the running version: ${e.message}`);
    return true;
  });
});

test('the parent module graph loads against the stub before the child is implemented', async () => {
  const dir = exampleCopy();
  const source = fs.readFileSync(path.join(dir, 'src', 'banner.mjs'), 'utf8');
  assert.match(source, /from '\.\.\/stubs\/greet\.mjs'/, 'the parent must be built against the stub, not an implementation');

  const child = await import(pathToFileURL(path.join(dir, 'stubs', 'greet.mjs')).href);
  assert.equal(child.__stub.contract, 'greet');

  const parent = await import(pathToFileURL(path.join(dir, 'src', 'banner.mjs')).href);
  assert.equal(typeof parent.banner, 'function');
  assert.throws(() => parent.banner('Ada'), { message: /^not implemented: greet\// });
});

test('the parent works unchanged once the child contract is implemented', async () => {
  const dir = exampleCopy();
  fs.writeFileSync(
    path.join(dir, 'stubs', 'greet.mjs'),
    'export function greet(name) {\n  return `Hello, ${name}.`;\n}\n\nexport function shout(name) {\n  return `HELLO, ${name.toUpperCase()}!`;\n}\n',
  );
  const parent = await import(pathToFileURL(path.join(dir, 'src', 'banner.mjs')).href);
  const out = parent.banner('Ada');
  assert.match(out, /Hello, Ada\./);
  assert.match(out, /HELLO, ADA!/);
});

test('committed example stubs are exactly what the generator emits', () => {
  const dir = artifact(example);
  for (const [format, file] of [['mjs', 'stubs/greet.mjs'], ['dts', 'stubs/greet.d.mts']]) {
    const out = artifact(`${example}/${file}`);
    const r = stub('greet', '--dir', dir, '--format', format, '--out', out, '--check');
    assert.equal(r.status, 0, r.stdout + r.stderr);
  }
});

test('--check fails on a stale stub and names the regenerate command', () => {
  const dir = exampleCopy();
  const out = path.join(dir, 'stubs', 'greet.mjs');
  fs.appendFileSync(out, '\nexport const drift = 1;\n');
  const r = stub('greet', '--dir', dir, '--out', out, '--check');
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /greet\.mjs/);
  assert.match(r.stderr, /tools\/stub\.mjs/);
});

test('the typed worked example is committed and checks types only', () => {
  const dts = fs.readFileSync(artifact(`${example}/stubs/greet.d.mts`), 'utf8');
  assert.match(dts, /export declare function greet\(name: string\): string;/);
  assert.match(dts, /export declare function shout\(name: string\): string;/);

  const ts = fs.readFileSync(artifact(`${example}/ts/banner.mts`), 'utf8');
  assert.match(ts, /from '\.\.\/stubs\/greet\.mjs'/, 'the typed parent must import the same specifier as the runtime parent');

  const tsconfig = JSON.parse(fs.readFileSync(artifact(`${example}/tsconfig.json`), 'utf8'));
  assert.equal(tsconfig.compilerOptions.noEmit, true);
  assert.match(String(tsconfig.compilerOptions.module), /^nodenext$/i, 'nodenext is what resolves ./x.mjs to x.d.mts');
});

test('errors name the cause and the remedy', () => {
  const prose = fixtureProject({ interface: 'Prose only, with no machine-readable block.' });
  const a = stub('demo-child', '--dir', prose);
  assert.notEqual(a.status, 0);
  assert.match(a.stderr, /demo-child/);
  assert.match(a.stderr, /STUBS\.md/);

  const b = stub('no-such-contract', '--dir', prose);
  assert.notEqual(b.status, 0);
  assert.match(b.stderr, /no-such-contract/);

  const c = stub('demo-child', '--dir', fixtureProject(), '--format', 'rust');
  assert.notEqual(c.status, 0);
  assert.match(c.stderr, /unknown --format/);
});
