# Bench 002 — results (all six runs complete)

Judge: `judge.mjs`, deterministic hidden corpus (2,000 docs, 25 malformed),
40 term queries, 20 phrase queries. Phrase P@10 ceiling is 0.80 (8 relevant
docs per phrase). Naive-reference calibration: terms 1.00, phrases 0.15,
size 1.23, p95 ~250 ms.

## J1 — trajectory (judged, per round)

| round | metric | P (protocol) | C (plain) |
|---|---|---|---|
| R1 build | term P@10 | 0.83 | 0.83 |
| | size ratio | 0.2525 | **0.1630** |
| | p95 | **101 ms** | 110 ms |
| R2 phrases | term P@10 | 0.83 | 0.83 |
| | phrase P@10 (max .80) | 0.78 | 0.78 |
| | size ratio | **0.3036** | 0.3207 |
| | p95 | 109 ms | **92 ms** |
| R3 optimize | term P@10 | 0.83 | 0.83 |
| | phrase P@10 | 0.78 | 0.78 |
| | size ratio | **0.2136** | 0.2981 |
| | p95 | 98 ms | **91 ms** |

Robustness (exit 0 on flawed corpus, exact skipped count): both arms, all
rounds, pass. Query failures: zero everywhere.

## J2 — regressions

**None, in either arm, on any judged dimension, in any round.** The
hypothesis that the plain arm would lose held ground under optimization
pressure did not materialize at this scale: every round-agent in both arms
independently built strong test suites (both arms invented mutation testing
unprompted) and honored "nothing may regress".

## J3 — honesty

Every agent's self-reported state matched the hidden judge. No gap.

## J4 — cost

| round | P tokens | C tokens |
|---|---|---|
| R1 | 181.8k | 153.7k |
| R2 | 213.9k | 157.4k |
| R3 | 290.1k | 285.1k |
| **total** | **685.8k** | **596.2k** |

Protocol overhead: **1.15x** over three rounds — and shrinking with task
size (bench 001's toy: 2.3x; here R3 alone: 1.02x). Wall time similar.

## J5 — what differed (process, not scoreboard)

- **R2 in the protocol arm was a real deprecation cascade**: three contracts
  deprecated (append-only log) and superseded; dependents re-pointed; every
  successor's gate also runs its predecessor's gate, so "no regression" is
  enforced by machinery, not by a note. The plain arm's R2 relied on the
  incoming agent's own discipline — which was excellent, but unenforced.
- **Floors moved with receipts in P**: index-size law 0.32 → 0.38 (positions
  cost, paid deliberately after encoding work brought a naive 0.4725 down to
  0.3727) → tightened to 0.26 in R3. The latency law was rewritten to a
  startup-ratio because absolute p95 swung 85–227 ms on the shared box with
  no code change — a measurement lesson now frozen in the law itself.
- **Final size**: P's interpolative coding beat C's front-coded varints
  (0.2136 vs 0.2981); **final p95**: C slightly ahead (91 vs 98 ms; ~70 ms
  of both is bare node start-up).

## Honest conclusion

At this scale (three ~1h rounds, capable agents, explicit no-regression
prompts), the protocol's scoreboard advantage is modest: better final size,
tied quality, ~15% token overhead. What it bought that the plain arm only
promised: regression protection and change management that hold **by
construction** — deprecations, successor gates, laws with receipts — rather
than by each stranger's discipline. In this benign run the insurance never
fired; the run cannot show what happens when an agent is careless, and that
is the honest limit of this experiment. The protocol arm's final tree is
preserved as `examples/ranked-search/`.
