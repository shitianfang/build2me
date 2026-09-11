# Bench 004 — SlopCodeBench pilot (the benchmark that measures OUR mechanism)

[SlopCodeBench](https://www.scbench.ai) (arXiv 2603.24755, 2026-03, actively
maintained: 36 problems / 196 checkpoints / 19 modern models) is the first
recognized benchmark whose METRIC is the thing this protocol exists to
prevent: agents extend THEIR OWN prior code across 3-8 checkpoints as specs
evolve, and the bench measures degradation — structural erosion rises in
80% of plain-agent trajectories, verbosity in 90%, and no agent fully
solves any problem (top strict solve 28.1% GPT-5.x, Claude 4.5/4.6 era
16.8-20.9%). Checkpoint relay by fresh sessions is literally this
protocol's regime; laws are its answer to erosion.

Why not the alternatives (2026 scan): FeatureBench — 2-9.7M input tokens
PER TASK, docker required; Terminal-bench 2 / SWE-bench Pro — single-
session tasks, they measure the model, not the protocol; Commit0 —
leaderboard dead since 2024-11 (bench 003 stands as our record there).

## Method

- Problems from the official [scb-problems](https://github.com/gabeorlanski/scb-problems)
  repo (canary-marked, post-training-cutoff data — contamination risk far
  lower than Commit0). Spec placeholders rendered exactly as the official
  harness does (entry_file / entry_command substitution).
- One FRESH Opus agent per checkpoint, seeing only the current rendered
  spec + the carried-over working directory (a build2me project). It never
  sees tests/, solutions/, or future checkpoints.
- Official scoring, run bare (no docker here; isolation caveat noted):
  `pytest tests/test_checkpoint_N.py --entrypoint "python <entry>"`.
  Workdir snapshotted per checkpoint; quality metrics computed on the
  snapshots afterward.
- Honest attribution: leaderboard rows are Claude 4.5/4.6-era under plain
  scaffolds; our runs are Opus 5 under the protocol — one model-generation
  gap, stated wherever numbers are shown. This is an unofficial local
  reproduction; an official submission needs their docker harness.

## Pilot

Problem `code_search` (difficulty Easy, 5 checkpoints). Go/no-go for a
wider sample after its cost and trajectory are known.

| checkpoint | official tests | tokens | notes |
|---|---|---|---|
| (pilot running) | | | |
