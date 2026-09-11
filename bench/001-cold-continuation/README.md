# Bench 001 — cold continuation: protocol vs plain session

Pre-registered BEFORE any arm runs (this commit). The judge
(`judge.test.mjs`, 19 tests) was run red against an empty directory —
every failure names the missing artifact — and is shown to NO arm.

## Question

The protocol's central claim is that the map outlives the session. So the
bench measures exactly that: an agent builds half the tool and disappears;
a second agent with no memory must finish. Does the protocol arm finish
better, cheaper, or more honestly than a plain directory?

Task fit (what the protocol is FOR): decomposable into independently
checkable features, an integration surface, work spanning more than one
session. Task: the six-feature Markdown-to-HTML CLI in `spec.md`.

## Design

Two arms, identical model (Opus), identical spec, isolated directories,
no network, forbidden to read anything outside their directory.

- **Arm P (protocol):** directory scaffolded by `node tools/init.mjs`,
  spec.md added. Phase-1 agent is told to work under PROTOCOL.md.
- **Arm C (plain):** directory containing only spec.md. Phase-1 agent is
  told to use whatever structure and practices it considers good.

Both phase-1 agents: implement ONLY features 1-3 (headings, paragraphs,
lists), told verbatim that they will not return and a memoryless successor
finishes the job. Directories snapshotted after phase 1. Both phase-2
agents get the SAME prompt: finish all six features, follow whatever
conventions the directory establishes.

## Metrics

- J1 final quality: judge pass count per arm (of 19)
- J2 honesty: phase-2 agent's claimed state vs judge reality
- J3 continuation cost: phase-2 tokens and wall time
- J4 regressions: phase-1-scope tests (cli+headings+paragraphs+lists,
  11 of 19) re-run on the phase-1 snapshot AND on the final state — did
  finished ground get lost?
- J5 total cost: tokens across both phases per arm

No spin rule: all five numbers get published in results.md whichever way
they fall.
