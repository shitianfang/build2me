# Laws

Laws are this project's axiom system: the rules every submission must conform
to. Conformance is checkable instantly — but only relative to the law as
written. Laws are amended by humans, deliberately; git is their version history.

A law is only a law if something enforces it. Prose without a check is advice.

- **L1 — contracts are immutable.** Contract files may only be added, never
  modified or deleted. Enforced by `tools/check-immutability.sh`. To change a
  contract: deprecate it (`node tools/deprecate.mjs <name> --reason ...`) and
  publish a successor under a new name.
- **L2 — deprecations.log is append-only.** Enforced by the same script.

Add your own as you build — not before. You cannot know up front which
dimensions this project needs to hold; you discover them: a slow page, an
unreadable module, a doc that lied. The moment one bites, freeze it as a law
so it can never bite again unnoticed:

1. Measure where you stand today; that number is the floor (the ground you
   already hold — start there, not at where you wish you were).
2. Write `laws/<id>.json` with {id, dimension, statement, check} — check is
   a command that exits 0 while the floor holds. The verifier runs it on
   every pass from now on.
3. Tighten the floor deliberately when you have margin; never loosen it
   silently.

A check must never call verify.mjs (verify runs the laws — it would re-enter).

## Declared laws

The five judged dimensions, each frozen at the level measured on
`sample-docs.jsonl` the day it was implemented. Every check runs the same
script that produces the numbers in a report, `bench/measure.mjs`, so a law and
a measurement cannot drift apart. Read the `statement` in each file for where
its number came from; `node bench/measure.mjs` prints all of them at once.

| law | dimension | floor |
|---|---|---|
| `index-size` | size | indexBytes / corpus bytes <= 0.26 (held: 0.2548; was <= 0.32, then <= 0.38 with positions) |
| `query-latency` | speed | startupRatio <= 1.32 (held: 1.19-1.26) and p95 query process <= 150 ms as a backstop |
| `corpus-robustness` | robustness | indexing exits 0 with exactly 120 docs / 5 skipped |
| `relevance-floor` | relevance | mean recall@10 >= 0.85 and mean P@10 >= 0.25 over `bench/queries.json` (held: 0.8533 / 0.2560) |
| `phrase-exactness` | phrase | quoted queries return all and only the documents holding the phrase: precision and recall both 1.0 |

`index-size` is the only floor that has ever been RAISED (0.32 -> 0.38, round
2): exact-phrase search cannot be answered from frequencies, and positions are
not free. It was raised deliberately, by the smallest amount the requirement
forced, with the encoding work done FIRST (a naive positional index measured
0.4725) and the receipt written into the law. Round 3 tightened it to 0.26 —
past the pre-positions level, positions included — by re-spending the postings
in bits instead of bytes. Read each law's `statement` for where its number came
from.

`query-latency` is the one floor that could not be tightened until its
MEASUREMENT was fixed. Almost all of a query process is node starting up, so a
millisecond floor on a shared machine mostly measures the neighbours: p95 here
moved 85-227 ms with no code change at all. `bench/measure.mjs` now runs an
empty `node -e 0` beside every timed query, and the law is asserted on
`startupRatio` — fastest query over fastest empty process — which stays put
when load stretches both. When a dimension resists tightening because the
number is noisy, fix the number, not the floor.

Operators inside a check are quoted (`--assert 'p95Ms<=150'`): checks run
through a shell, where an unquoted `<` or `>` is a redirection.
