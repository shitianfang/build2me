#!/usr/bin/env node
// Contract: search-cli-phrases — the whole user-facing surface, and nothing else.
// Every behaviour below belongs to a library contract; this file only parses
// argv, resolves ./index against the working directory, and formats output.
// A quoted query ("alpha beta") is one composition step more than an unquoted
// one: phrase-matching narrows the candidate documents, bm25-ranking orders
// them, and the same ten-ids-one-per-line contract applies to both.
//
// A query is one short-lived process judged on wall-clock time, and a module it
// never calls still costs its parse and link. So each command imports exactly
// the libraries it uses: `query` and `stats` never pay for lib/corpus.mjs, and
// `stats` pays for lib/index-format.mjs alone. `process` is used as the global
// it is for the same reason — importing node:process measures ~3 ms here, more
// than every library in this project put together.
import fs from 'node:fs';
import path from 'node:path';

const RESULTS = 10;
const USAGE = 'usage: node search.mjs index <docs.jsonl> | query "<terms>" | stats';
const indexDir = path.resolve(process.cwd(), 'index');

// Output goes straight to the file descriptor. Reaching for the process's
// stream objects builds a WriteStream this program uses exactly once (~0.7 ms
// of a ~15 ms job, with the occasional multi-millisecond spike), and a
// synchronous write also cannot be truncated by the process.exit below it.
const write = (fd, text) => {
  const bytes = Buffer.from(text, 'utf8');
  let at = 0;
  while (at < bytes.length) at += fs.writeSync(fd, bytes, at);
};

const fail = (message) => {
  write(2, `search: ${message}\n${USAGE}\n`);
  process.exit(1);
};

const open = (openIndex) => {
  try {
    return openIndex(indexDir);
  } catch (e) {
    return fail(e.message);
  }
};

const bytesUnder = (dir) => fs.readdirSync(dir, { withFileTypes: true }).reduce(
  (n, e) => n + (e.isDirectory() ? bytesUnder(path.join(dir, e.name)) : fs.statSync(path.join(dir, e.name)).size), 0);

const commands = {
  async index(args) {
    if (args.length !== 1) return fail(`index takes exactly one corpus path, got ${args.length}`);
    const [{ readCorpus }, { buildIndex, writeIndex }] = await Promise.all([
      import('./lib/corpus.mjs'), import('./lib/index-format.mjs')]);
    let corpus;
    try {
      corpus = readCorpus(args[0]);
    } catch (e) {
      return fail(e.message);
    }
    writeIndex(indexDir, buildIndex(corpus.docs, { docs: corpus.docs.length, skipped: corpus.skipped }));
  },
  async query(args) {
    if (args.length === 0) return fail('query takes the search terms as its argument');
    const terms = args.join(' ');
    const [{ openIndex }, { tokenize }, { rank }, { quotedPhrases, phraseDocIds }] = await Promise.all([
      import('./lib/index-format.mjs'), import('./lib/analyze.mjs'),
      import('./lib/rank.mjs'), import('./lib/phrase.mjs')]);
    const reader = open(openIndex);
    // null = no quoted phrase, so no restriction; a Set = the only ids allowed
    // through, which is why the ranking below is asked for every document.
    const allowed = phraseDocIds(reader, quotedPhrases(terms));
    const ids = rank(reader, tokenize(terms), allowed ? reader.docCount : RESULTS)
      .filter((id) => allowed === null || allowed.has(id)).slice(0, RESULTS);
    if (ids.length > 0) write(1, `${ids.join('\n')}\n`);
  },
  async stats(args) {
    if (args.length !== 0) return fail(`stats takes no arguments, got ${args.length}`);
    const { openIndex } = await import('./lib/index-format.mjs');
    const { meta } = open(openIndex);
    write(1, `${JSON.stringify({
      docs: meta.docs ?? 0, skipped: meta.skipped ?? 0, indexBytes: bytesUnder(indexDir),
    })}\n`);
  },
};

const [command, ...args] = process.argv.slice(2);
if (command === undefined) fail('no command given');
if (!Object.hasOwn(commands, command)) fail(`unknown command "${command}"`);
await commands[command](args);
