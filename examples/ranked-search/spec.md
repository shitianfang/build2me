# search.mjs — a ranked full-text search CLI

Zero-dependency Node (>= 20). Three commands, run from the project root:

- `node search.mjs index <docs.jsonl>` — build an index under `./index/`
  (any file layout you choose; created if missing, fully overwritten per run).
- `node search.mjs query "<terms>"` — print the ids of the 10 most relevant
  docs, best first, one id per line (fewer lines only if fewer docs qualify).
  A query wrapped in double quotes — `node search.mjs query '"alpha beta gamma"'` —
  is an EXACT PHRASE: only docs where those words occur adjacent and in order
  (in title or body, after your tokenization) may be printed, still ranked,
  still capped at 10. Unquoted queries keep the old behavior. (Round-2
  amendment; the root contract is `ranked-phrase-search`.)
- `node search.mjs stats` — print one JSON object:
  `{"docs": <indexed count>, "skipped": <malformed line count>, "indexBytes": <total bytes under index/>}`.

Corpus format: one JSON object per line, `{"id": "...", "title": "...",
"body": "..."}`. Lines that are not valid JSON or miss a field are SKIPPED
and counted — indexing must still succeed (exit 0). A sample corpus for
development is in `sample-docs.jsonl`; the judged corpus is different but
has the same schema and the same kind of flaws.

Relevance: rank by how well title+body match ALL query terms. The judged
queries are hidden and scored against labeled relevant sets (P@10). Term
weighting that rewards rare terms (e.g. TF-IDF/BM25) is the known-good
direction; the choice and tuning are yours.

Tokenization: at minimum lowercase + alphanumeric runs; better analyzers
are allowed and judged only through P@10.

What is measured (every round, hidden judge, one command):
- relevance: mean P@10 over hidden labeled queries, phrase queries included
- size: indexBytes / corpus bytes
- speed: p95 wall-ms per query (process start to exit)
- robustness: indexing the flawed corpus exits 0 and `skipped` is exact
- phrase exactness: a quoted query returns all and only the docs holding it

Errors (wrong args, missing files): message on stderr, exit 1.
