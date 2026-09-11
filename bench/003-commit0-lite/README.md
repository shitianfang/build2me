# Bench 003 — Commit0-lite campaign (incremental, monotone)

[Commit0](https://github.com/commit-0/commit0) is a published benchmark:
reimplement real Python libraries from their official skeletons (signatures
+ docstrings, bodies stripped) until the library's own test suite passes.
Public lite-split baselines: OpenHands 41.24% aggregate pass rate, Claude
Sonnet 3.5 variants 18–31%, gold 100%.

## Why this one

As single repos these are session-sized tasks; as a CAMPAIGN the 16-repo
lite split (tens of kLOC, thousands of official tests) exceeds any one
context — which is the regime this protocol exists for. The campaign is
the build2me project: one front per repo, sessions relay through the
scoreboard, and a completed repo's pass rate is a floor that never drops.

## Method and integrity

- Skeleton pinned at the benchmark's official `base_commit`; `.git`
  stripped before the agent sees the tree (the reference solution lives in
  the fork's history).
- Agent may install only the listed test dependencies; installing or
  consulting the real library is forbidden and stated in the prompt.
- Scoring: the campaign runner restores a pristine copy of `tests/` and
  the pytest config, then runs the repo's official test command; the
  scoreboard records that independent count, never the agent's claim.
- No docker (not available here): tests run in a local uv venv per repo.
  Same tests, same skeleton commit; environment noted per row.

Honest attribution: the pass rate is mostly the model (Opus 5 vs the
2024-era baselines above); the protocol is the campaign vehicle — relay
state, monotone floors, zero human review of implementations. Pretraining
contamination caveats apply to every Commit0 entry, including this one.

## Scoreboard (append-only; a row's rate may only ever rise)

| repo | official tests passed | rate | agent tokens | date |
|---|---|---|---|---|
| (campaign starts with tinydb) | | | | |
