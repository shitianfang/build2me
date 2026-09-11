# build2me

**A prove2me-style protocol for building software with swarms of parallel
agents:** an immutable contract DAG, lock-free optimistic coordination,
machine-checkable acceptance per node, cascade verification, and a one-number
scheduler — no task board, no assignments, no human merge bottleneck.

[Prove2Me](https://arxiv.org/abs/2608.28433) let a swarm of Claude agents
[formalize Fermat's Last Theorem in Lean in 11
days](https://www.anthropic.com/research/formalizing-fermats-last-theorem):
30,300 generated theorems, no human reviewing proofs — trust rested on the
kernel's acceptance of proofs against a small set of immutable, human-audited
statements. Its authors tried the obvious alternatives first — agents
co-editing shared files (they interfere; work can't be partitioned) and git PR
workflows (human merge review becomes the bottleneck) — and built the protocol
because both fail. Those two failure modes are exactly where multi-agent
*software* development stands today.

build2me transplants that protocol to engineering, paying explicitly for the
two places software is harder than mathematics:

1. **Composition is not free.** Children passing their gates doesn't mean the
   parent works, so a parent's acceptance is an integration gate that actually
   runs at cascade time.
2. **Statements change.** Requirements drift; contracts are never edited but
   deprecated, which re-opens dependents — the cascade in reverse.

Read [PROTOCOL.md](PROTOCOL.md) — an agent that has read it can participate
correctly.

## Quickstart

Requires Node >= 20 and git. Zero dependencies.

```sh
git clone https://github.com/shitianfang/build2me
cd build2me

node tools/verify.mjs     # the kernel: statuses, verdicts, gates — must be green on main
node tools/frontier.mjs   # the scheduler: what to work on next, ranked by cascade leverage
```

Try the full lifecycle on the built-in miniature project (a sketched parent
over one Done and one Open child):

```sh
node tools/verify.mjs   --dir acceptance/fixtures/demo
node tools/frontier.mjs --dir acceptance/fixtures/demo
```

Implement the open `mul` contract in a copy of that fixture and watch `calc`
flip to Done by cascade — or just read
[acceptance/example-flow.test.mjs](acceptance/example-flow.test.mjs), which
does exactly that, verified in CI.

## This repository is self-hosting

build2me is developed under its own protocol. The system is the `root`
contract, decomposed into nine children; the verifier, frontier tool,
immutability check, protocol document, and example flow are Done — their
acceptance gates are this repo's CI — and the remaining children are **an
honest, open frontier**:

- `typed-stub-semantics` — compile-against-stub gates for typed languages
- `deprecation-cascade` — tooling for deprecation with downstream re-open
- `agent-server` — the optimistic-concurrency HTTP form of the protocol
- `slow-loop-instruments` — co-change misalignment reports and cold-agent drills

`node tools/frontier.mjs` in this repo prints precisely that list. If you want
to contribute, that command *is* the contribution guide: pick a leaf, read its
contract, submit. The protocol you'd be following is the one you'd be building.

## Status

v0.1 — git-native (branches carry attempts; CI is the verifier). The server
form, typed stubs, deprecation tooling, and slow-loop instruments are open
contracts, deliberately: this README's claims should never outrun `verify.mjs`.

## License

MIT
