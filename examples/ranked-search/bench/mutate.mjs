#!/usr/bin/env node
// Are the gates real? Copy the project into .tmp/, break exactly one thing,
// run that contract's acceptance gate against the copy, and report whether the
// gate noticed. Nothing in the working tree is touched.
//
//   node bench/mutate.mjs      # exits non-zero if any mutation slips through
//
// This is how "run every gate red for the right reason" stays true after the
// implementation exists: a gate that passes on a broken implementation is
// decoration. Two real holes were found this way and closed — bm25-ranking
// once accepted a scorer with no idf and one with no coverage factor, because
// its assertions were satisfiable by BM25's raw sum alone. Add a mutant here
// whenever you add behaviour worth gating.
//
// The gate run is the contract's own `acceptance` command, read from
// contracts/<name>.json — not a test file guessed from the contract name. A
// successor contract runs its predecessor's gate as well as its own, and a
// mutant must face everything the contract actually claims.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mutants = [
  ['corpus-reader', 'lib/corpus.mjs', 'if (BLANK.test(line)) return;', 'if (BLANK.test(line)) { skipped++; return; }', 'blank lines counted as skips'],
  ['corpus-reader', 'lib/corpus.mjs', "if (typeof id !== 'string' || typeof title !== 'string' || typeof body !== 'string') {", "if (typeof id !== 'string') {", 'missing title/body accepted'],
  ['text-analyzer', 'lib/analyze.mjs', ".normalize('NFD').replace(COMBINING_MARKS, '')", '', 'diacritics no longer folded'],
  ['text-analyzer', 'lib/analyze.mjs', 'return folded.match(TOKEN) ?? [];', "return folded.split(' ').filter((t) => t !== '');", 'punctuation kept inside tokens'],
  ['positional-index', 'lib/index-format.mjs', 'fs.rmSync(dir, { recursive: true, force: true });\n  fs.mkdirSync', 'fs.mkdirSync', 'stale index files survive a rewrite'],
  ['positional-index', 'lib/index-format.mjs', 'bicWrite(postBytes, at, 0, at.length - 1, 0, spans[p.docs[i]] - 1);', 'bicWrite(postBytes, at, 0, at.length - 1, 0, spans[p.docs[i]]);', 'the position universe is written one wider than it is read'],
  ['positional-index', 'lib/index-format.mjs', 'for (const i of repeats) gammaWrite(postBytes, p.positions[i].length - 1);', 'for (const i of repeats) gammaWrite(postBytes, p.positions[i].length);', 'repeat counts off by one'],
  ['positional-index', 'lib/index-format.mjs', 'bytes.bytes(keys[i].subarray(shared));', 'bytes.bytes(keys[i]);', 'front-coded entries keep the prefix they claim to share'],
  ['positional-index', 'lib/index-format.mjs', 'buf.copy(keyBuf, shared, pos, pos + len);', 'buf.copy(keyBuf, 0, pos, pos + len);', 'the shared prefix is dropped when a dictionary block is read'],
  ['positional-index', 'lib/index-format.mjs', 'postLens.push(postBytes.len - from);', 'postLens.push(0);', 'block-skip offsets stop counting posting-list lengths'],
  ['positional-index', 'lib/index-format.mjs', 'export const bodyPosition = (titleLen, j) => titleLen + 1 + j;', 'export const bodyPosition = (titleLen, j) => titleLen + j;', 'title and body share a coordinate (a phrase could straddle them)'],
  ['positional-index', 'lib/index-format.mjs', 'while (title < tf && positions[title] < titleLen) title++;', '', 'title frequencies dropped from postings'],
  ['bm25-ranking', 'lib/rank.mjs', 'const coverage = hit.covered >= coverable ? 1 : (hit.covered / coverable) ** COVERAGE;', 'const coverage = 1;', 'query coverage ignored'],
  ['bm25-ranking', 'lib/rank.mjs', 'const tf = p.body + TITLE_WEIGHT * p.title;', 'const tf = p.body + p.title;', 'title hits weigh the same as body hits'],
  ['bm25-ranking', 'lib/rank.mjs', 'const idf = Math.log(1 + (total - postings.length + 0.5) / (postings.length + 0.5));', 'const idf = 1;', 'rare terms no longer favoured'],
  ['bm25-ranking', 'lib/rank.mjs', 'scored.sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));', 'scored.sort((a, b) => b.score - a.score);', 'ties no longer deterministic'],
  ['phrase-matching', 'lib/phrase.mjs', 'return elsewhere.every(([i, positions]) => positions.includes(start + i));', 'return elsewhere.every(([, positions]) => positions.length > 0);', 'adjacency ignored: any document holding the words matches'],
  ['phrase-matching', 'lib/phrase.mjs', 'const start = p - rarest.i;   // where the phrase would have to begin', 'const start = p;', 'word order ignored'],
  ['phrase-matching', 'lib/phrase.mjs', 'if (close === -1) break;            // unterminated: not a phrase', 'if (close === -1) { phrases.push(tokenize(raw.slice(from + 1))); break; }', 'an unterminated quote becomes a phrase'],
  ['phrase-matching', 'lib/phrase.mjs', 'if (list.length === 0) return null;', 'if (list.length === 0) return new Set();', 'no phrase confused with nothing matches'],
  ['search-cli-phrases', 'search.mjs', 'process.exit(1);', 'process.exit(0);', 'errors exit 0'],
  ['search-cli-phrases', 'search.mjs', 'const RESULTS = 10;', 'const RESULTS = 25;', 'more than ten results printed'],
  ['search-cli-phrases', 'search.mjs', '.filter((id) => allowed === null || allowed.has(id))', '.filter(() => true)', 'the CLI never applies the phrase filter'],
  ['ranked-phrase-search', 'lib/rank.mjs', 'scored.sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));', 'scored.sort((a, b) => a.score - b.score);', 'worst documents ranked first'],
  ['ranked-phrase-search', 'search.mjs', 'rank(reader, tokenize(terms), allowed ? reader.docCount : RESULTS)', "rank(reader, terms.split(' '), allowed ? reader.docCount : RESULTS)", 'query bypasses the shared analyzer'],
  ['ranked-phrase-search', 'lib/phrase.mjs', 'if (phrase.length === 0 || !reader || (reader.docCount ?? 0) === 0) return [];', 'if (true) return [];', 'every phrase query answers nothing'],
];

let bad = 0;
for (const [contract, file, from, to, label] of mutants) {
  const dir = fs.mkdtempSync(path.join(root, '.tmp', 'mutant-'));
  for (const entry of ['lib', 'acceptance', 'bench', 'tools', 'contracts', 'impl', 'laws', 'search.mjs', 'sample-docs.jsonl']) {
    if (fs.existsSync(path.join(root, entry))) fs.cpSync(path.join(root, entry), path.join(dir, entry), { recursive: true });
  }
  const target = path.join(dir, file);
  const src = fs.readFileSync(target, 'utf8');
  if (!src.includes(from)) { console.log(`SKIP  ${contract.padEnd(15)} anchor missing: ${label}`); fs.rmSync(dir, { recursive: true, force: true }); bad++; continue; }
  fs.writeFileSync(target, src.replace(from, to));
  const { acceptance } = JSON.parse(fs.readFileSync(path.join(dir, 'contracts', `${contract}.json`), 'utf8'));
  const r = spawnSync(acceptance, { cwd: dir, shell: true, encoding: 'utf8', timeout: 300000 });
  const failing = (r.stdout.match(/^not ok /gm) ?? []).length;
  const caught = r.status !== 0;
  console.log(`${caught ? 'CAUGHT' : 'MISSED'}  ${contract.padEnd(15)} ${label}${caught ? ` (${failing} assertion(s) red)` : ''}`);
  if (!caught) bad++;
  fs.rmSync(dir, { recursive: true, force: true });
}
console.log(bad === 0 ? 'every mutation was caught by its own gate' : `${bad} mutation(s) slipped through`);
process.exit(bad === 0 ? 0 : 1);
