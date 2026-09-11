// Pre-registered hidden judge for bench 001. Runs against the directory in
// MD_DIR. Never shown to either arm before both finish. Tests only what
// spec.md states, examples included verbatim.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const dir = process.env.MD_DIR;
if (!dir) throw new Error('set MD_DIR to the directory under judgment');
const mdjs = path.join(dir, 'md.mjs');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'md-judge-'));
let n = 0;
const render = (src) => {
  assert.ok(fs.existsSync(mdjs), `missing artifact: ${mdjs}`);
  const f = path.join(tmp, `in-${n++}.md`);
  fs.writeFileSync(f, src);
  return spawnSync('node', [mdjs, f], { cwd: dir, encoding: 'utf8', timeout: 30000 });
};
const expect = (src, out) => {
  const r = render(src);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, `${out}\n`);
};

// --- cli ---
test('cli: no argument fails with a message', () => {
  assert.ok(fs.existsSync(mdjs), `missing artifact: ${mdjs}`);
  const r = spawnSync('node', [mdjs], { cwd: dir, encoding: 'utf8', timeout: 30000 });
  assert.equal(r.status, 1);
  assert.ok(r.stderr.trim().length > 0);
});
test('cli: unreadable file fails with a message', () => {
  assert.ok(fs.existsSync(mdjs), `missing artifact: ${mdjs}`);
  const r = spawnSync('node', [mdjs, path.join(tmp, 'nope.md')], { cwd: dir, encoding: 'utf8', timeout: 30000 });
  assert.equal(r.status, 1);
  assert.ok(r.stderr.trim().length > 0);
});
// --- headings ---
test('headings: h1', () => expect('# Title', '<h1>Title</h1>'));
test('headings: h3', () => expect('### Deep', '<h3>Deep</h3>'));
test('headings: # without space is a paragraph', () => expect('#NoSpace', '<p>#NoSpace</p>'));
// --- paragraphs ---
test('paragraphs: internal newline becomes a space', () => expect('line one\nline two', '<p>line one line two</p>'));
test('paragraphs: blank line separates blocks', () => expect('a\n\nb', '<p>a</p>\n<p>b</p>'));
test('paragraphs: escaping', () => expect('x < y & z > w', '<p>x &lt; y &amp; z &gt; w</p>'));
// --- lists ---
test('lists: one li per line', () => expect('- one\n- two\n- three', '<ul><li>one</li><li>two</li><li>three</li></ul>'));
test('lists: document of plain blocks', () =>
  expect('# T\n\np q\n\n- a\n- b', '<h1>T</h1>\n<p>p q</p>\n<ul><li>a</li><li>b</li></ul>'));
// --- emphasis ---
test('emphasis: bold', () => expect('**bold** word', '<p><strong>bold</strong> word</p>'));
test('emphasis: italic', () => expect('*it*', '<p><em>it</em></p>'));
test('emphasis: mixed', () => expect('mix **b** and *i*', '<p>mix <strong>b</strong> and <em>i</em></p>'));
// --- code ---
test('code: inline span escapes', () => expect('`a<b`', '<p><code>a&lt;b</code></p>'));
test('code: no inline rules inside a span', () => expect('`**x**`', '<p><code>**x**</code></p>'));
test('code: fenced block verbatim with escapes', () =>
  expect('```\nif (a < b) {\n  run(a & b);\n}\n```', '<pre><code>if (a &lt; b) {\n  run(a &amp; b);\n}</code></pre>'));
// --- links ---
test('links: basic', () => expect('[home](https://x.dev)', '<p><a href="https://x.dev">home</a></p>'));
test('links: bold inside text', () => expect('[see **docs**](u)', '<p><a href="u">see <strong>docs</strong></a></p>'));
// --- integration ---
test('integration: full document', () =>
  expect('# The **Tool**\n\nRead the [guide](g.md) and run `npm < x`.\n\n- fast *and* small\n- zero deps\n\n```\ncode <tag>\n```',
    '<h1>The <strong>Tool</strong></h1>\n<p>Read the <a href="g.md">guide</a> and run <code>npm &lt; x</code>.</p>\n<ul><li>fast <em>and</em> small</li><li>zero deps</li></ul>\n<pre><code>code &lt;tag&gt;</code></pre>'));
