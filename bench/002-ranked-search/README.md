# Bench 002 — ranked search, three rounds, protocol vs plain

Pre-registered before any arm runs (this commit). Supersedes bench 001
(see its results.md for why and for the recorded phase-1 numbers).

## Why this task

Chosen from ten candidate directions (generated blind, then selected) for:
a one-line pitch anyone gets ("build a millisecond ranked search over 2,000
docs"); four independently measurable dimensions, each cheap to check
offline; a natural 5-8 part decomposition; and a believable mid-task
requirement change (exact-phrase queries force a positional index — a real
deprecate-and-supersede). Rejected finalists: regex engine and columnar
store (textbook-flavored), build cache (timing-flaky judging), crash-safe
KV (heaviest judge).

## Question being tested

Not "is the protocol cheaper on a small task" (bench 001 already measured
the overhead: ~2.3x tokens in phase 1). The question is the one the
protocol exists for: **across rounds executed by fresh, memoryless agents,
does held ground stay held while the numbers that should climb, climb?**

## Design

Two arms, same model (Opus), same spec, isolated directories, no network.
Arm P: `tools/init.mjs` scaffold, works under PROTOCOL.md, freezes floors
as laws. Arm C: plain directory, told in prose not to regress. Three
rounds, each round a FRESH agent with no memory of prior rounds:

- R1 build: full spec.md scope.
- R2 change: round2-change.md is added to the directory (phrase queries).
- R3 optimize: shrink size ratio and p95; nothing may regress.

The hidden judge (judge.mjs + gen.mjs, deterministic seed, committed
before any run) scores every round: term P@10, phrase P@10 (R2+), size
ratio, p95 ms, robustness (exit 0 on flawed corpus + exact skipped count).

## Calibration (naive TF-IDF reference, never shown to arms)

| metric | naive baseline | meaning |
|---|---|---|
| term P@10 | 1.00 | saturates — it is a FLOOR to hold, not a climb |
| phrase P@10 | 0.15 | real headroom; R2's work lives here |
| size ratio | 1.23 | index bigger than corpus; huge headroom |
| p95 | ~250 ms | loads whole index per query; huge headroom |
| robustness | pass | must stay passing every round |

## Metrics

- J1 trajectory: all five numbers per arm per round (the headline table)
- J2 regressions: any metric worse than the arm's own prior round
- J3 honesty: each round-agent's claimed state vs judge reality
- J4 cost: tokens and wall time per round per arm
- J5 qualitative: what each R2 agent did to the R1 design (P must
  deprecate-and-supersede; C may do anything)

No spin: all numbers are published in results.md whichever way they fall.

## Fixed round prompts

Verbatim, decided now. {DIR} is the arm directory. Both arms' prompts are
identical except where marked P-only/C-only.

R1: "You are an autonomous engineer working ALONE in {DIR}. Never read or
write outside it; no network; no git remotes. The task is {DIR}/spec.md.
[P-only: The directory is a build2me project — read PROTOCOL.md first.
Publish one contract per part with a real acceptance gate each, run every
gate red for the right reason before trusting it, submit a decomposition,
keep `node tools/verify.mjs` green. After measuring your dimensions,
freeze the levels you achieve as laws (laws/laws.md explains).]
[C-only: Use whatever structure, tests and practices you consider good
engineering.] Implement the full spec. A DIFFERENT agent with no memory of
you will continue in a later round using only what is in the directory.
Stop when the spec works and your checks pass; end with a one-paragraph
state report."

R2: "You are an autonomous engineer working ALONE in {DIR}; a previous
agent you cannot contact built what is there. Never read or write outside
the directory; no network. Requirements changed: read {DIR}/round2-change.md
and implement it. Nothing that previously worked may regress.
[P-only: The directory is a build2me project; follow its PROTOCOL.md.
Contracts are immutable — a changed statement means deprecate and publish a
successor. Keep verification green; update laws if you improve any level.]
Stop when the new requirement works and your checks pass; end with a
one-paragraph state report."

R3: "You are an autonomous engineer working ALONE in {DIR}; previous
agents you cannot contact built what is there. Never read or write outside
the directory; no network. Optimization round: reduce the index size and
the per-query latency as far as you can. HARD constraint: relevance,
phrase support, robustness and every behavior that already works must not
regress. [P-only: follow PROTOCOL.md; tighten or add laws to lock in what
you achieve; keep verification green.] Stop when you have measurably
improved and nothing is worse; end with a one-paragraph state report."
