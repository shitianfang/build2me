# ranked-search

A [build2me](https://github.com/shitianfang/build2me) project: contracts are
immutable statements with machine-checkable acceptance, agents work the frontier
without locks, and the verifier is the only judge.

```sh
node tools/verify.mjs     # the kernel — statuses, verdicts, gates, laws
node tools/frontier.mjs   # what to work on next, ranked by closability
```

The deliverable is `search.mjs`, a zero-dependency ranked full-text search CLI
over a JSONL corpus (`spec.md` is the brief, restated as the root contract's
interface):

```sh
node search.mjs index sample-docs.jsonl   # writes ./index/
node search.mjs query "wadiki dixo"       # up to 10 document ids, best first
node search.mjs query '"wadiki dixo"'     # exact phrase: adjacent, in order, still ranked
node search.mjs stats                     # {"docs":120,"skipped":5,"indexBytes":23403}
```

All seven live contracts are Done, three are Deprecated, and the frontier is
empty. To change something, start at `docs/DESIGN.md` (the map: what each part
owns, the index format, the five measured dimensions, what the bench already
taught us, how round 2's changed requirement moved through the contracts, and
what round 3 bought on size and speed), then `PROTOCOL.md` for the rules — contracts and merged submissions are
immutable, so a change means deprecating and superseding, never editing.

```sh
node bench/measure.mjs    # the five judged dimensions, measured
node bench/sweep.mjs      # retune relevance against the real rank()
node bench/mutate.mjs     # break one thing at a time; every gate must notice
```
