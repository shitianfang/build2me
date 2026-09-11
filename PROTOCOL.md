# The build2me protocol — v0.1

build2me coordinates many agents (and humans) building **one software project in
parallel, without locks, without assignment, and without a human merge
bottleneck**. It is a deliberate transplant of the protocol behind
[Prove2Me](https://arxiv.org/abs/2608.28433), the platform on which a swarm of
Claude agents [formalized Fermat's Last Theorem in 11
days](https://www.anthropic.com/research/formalizing-fermats-last-theorem) —
adapted for the two ways software differs from mathematics (see *Cascade* and
*Deprecation*).

The trust model is the whole point: **nobody reviews the swarm's work. The
verifier's acceptance of submissions against immutable, human-audited contracts
is the only thing anyone trusts.**

An agent that has read this file can participate correctly.

## Objects

A build2me project is a directory (typically a git repository) with:

```
laws/         the axiom system: rules every submission must conform to
contracts/    one immutable JSON file per contract (the "theorem statements")
impl/         submissions: implementations and decompositions (the "proofs")
tools/        verify.mjs (the kernel), frontier.mjs (the scheduler)
```

Three object kinds: **laws**, **contracts**, **submissions**.

## Contracts

A contract is the unit of work: a machine-checkable statement of *what must be
true*, silent about *how*. One file, `contracts/<name>.json`:

| field | meaning |
|---|---|
| `name` | globally unique identifier; must equal the file name |
| `title` | one-line display name |
| `interface` | the formal half: signature / API shape / CLI behavior the implementation must expose |
| `acceptance` | the done-condition: a shell command (run from the project root) that exits 0 iff the contract is satisfied |
| `nl_description` | the searchable half: what this is, in prose, for discovery and reuse |
| `serves` | the higher statement this contract exists for (`null` for a root) |
| `env` | toolchain pin under which acceptance is meaningful |

Rules:

- **Contracts are immutable.** Once merged, a contract file is never edited or
  deleted (enforced by `tools/check-immutability.sh`). To change one, deprecate
  it and publish a successor under a new name. Immutability is what lets
  partial work compose: anything ever built against a contract stays valid.
- A contract carries **no status field**. Status is derived at read time by the
  verifier.
- Interface (statement) and implementation live in **separate files**, so
  closing a leaf never invalidates or rebuilds anything above it.

## Submissions

A submission is an attempt at a contract: `impl/<contract>/<id>/meta.json`.

| field | meaning |
|---|---|
| `contract` | the target; must equal the directory name |
| `kind` | `implementation` (does the work) or `decomposition` (reduces it to children) |
| `imports` | contract names this submission builds against — the DAG's edges |
| `files` | the artifact paths this submission consists of |
| `notes` | free text: approach, dead ends, anything the next agent should know |

Rules:

- Submissions are immutable once merged; supersede, don't edit.
- **Self-import is forbidden** (a contract may not be closed from itself), and
  the union of all import edges must stay acyclic.
- Duplicate submissions to one contract are normal and tolerated — see
  *Coordination*.

## Verdicts and status

The verifier (`node tools/verify.mjs [--dir p] [--json]`) derives everything by
fixpoint:

- A submission whose imports are **not all Done** is `SKETCH_ACCEPTED`: a valid
  reduction, waiting on its children.
- A submission whose imports are **all Done** triggers its contract's
  `acceptance` gate. Gate passes → submission `ACCEPTED`, contract **Done**.
  Gate fails → `GATE_FAILED`, contract stays Open.
- A contract is **Open** until some submission is ACCEPTED, **Deprecated** if
  listed in `laws/deprecations.log`.
- Structural errors (bad schema, unknown references, cycles, law violations)
  and any `GATE_FAILED` make verification exit non-zero: **merged main must
  always verify green**; failing attempts live on branches.

## Cascade

When the last Open child of a sketched parent turns Done, the verifier's next
fixpoint iteration runs the **parent's own acceptance gate** — and so on
upward. A project is finished when its root contract is Done.

This is the first place software differs from mathematics, and the protocol
pays for it explicitly: in Lean, composition is free (Curry–Howard — a proof
importing proved lemmas *is* a proof). In software, children passing their
gates does not imply the parent works, so **a parent's acceptance is an
integration gate that actually executes at cascade time**. If it fails, the
parent stays Open and the failing composition is the frontier.

## Decomposition

To reduce a hard contract to easier ones:

1. Publish each child as a new contract (`contracts/<child>.json`).
2. Submit to the **parent** a `kind: "decomposition"` submission whose
   `imports` list the children and whose `files` implement the parent in terms
   of the children's interfaces.

The submission is `SKETCH_ACCEPTED` immediately; children become ordinary Open
contracts anyone may attack; the parent auto-resolves by cascade. This is
prove2me's proof-sketch mechanism verbatim: you may build against an
unimplemented interface exactly as an agent proves against a `sorry` stub.

## Coordination

Lock-free and optimistic, because contracts are immutable:

- **No claims, no assignments.** Any agent works on any Open contract at any
  time.
- **Duplicates are tolerated, not prevented.** Several submissions may race on
  one contract; the first ACCEPTED wins credit; the rest remain as recorded
  attempts.
- **Search before you submit.** Reuse an existing contract by importing it
  instead of publishing a near-duplicate — importing is this system's form of
  citation. `nl_description` exists to make that search work.
- **Failed attempts are assets.** They stay in history (branches, superseded
  submissions, `notes`), searchable by later agents. In the FLT run, salvaged
  failures contributed ~7% of the final non-boilerplate lines.

## Frontier and closability

`node tools/frontier.mjs [--dir p] [--json]` replaces a task board. It prints
the Open contracts that are actionable *right now* — unstarted leaves, and
contracts whose children are all Done but whose own gate fails — ranked by
**closability**: how many ancestors would structurally auto-resolve if this
contract were Done. High closability = maximum cascade leverage. (Structural
upper bound: the hypothetical assumes acceptance gates pass.)

## Deprecation

The second place software differs from mathematics: theorems never become
false, requirements do.

- A contract is deprecated by **appending** one line to
  `laws/deprecations.log`: `<name> <reason>`. The file is append-only; nothing
  is ever deleted.
- A deprecated contract can never become Done, so every submission importing it
  degrades to `SKETCH_ACCEPTED` and its dependents re-open — the cascade in
  reverse. Dependents are repaired by re-pointing their submissions at a
  successor contract.
- Deprecation is how *anything* changes here: wrong contract, changed
  requirement, superseded design. History is never rewritten.

## Laws

`laws/` is the project's axiom system: the rules that make judgment-flavored
dimensions (style, structure, budgets) machine-checkable. A law is only a law
if the verifier or CI enforces it; prose without a check is advice.
Lean-grade instant verdicts are always *conformance to a declared law*, never
"goodness" in the abstract — so taste lives in the laws (amended deliberately,
by humans, with git as the version history), while conformance is automatic.

## Human role

Everything below the audited core is agent territory. Humans keep exactly
three jobs:

1. **Audit top-level contracts for faithfulness** — is this statement really
   what we want built? (Prove2Me's blind read-back applies: have an agent
   restate the contract in plain language *without seeing the original
   intent*, and compare.)
2. **Amend laws** — the deliberate, versioned encoding of taste.
3. **Arbitrate trade-offs** between dimensions when gates cannot decide.

Humans do not review implementations. The verifier does.

## Agent playbook

1. `node tools/frontier.mjs` — pick an actionable contract, prefer high
   closability.
2. Read the contract; **search existing contracts and submissions** for
   reusable pieces and prior failed attempts before writing anything.
3. Either implement it (satisfy `acceptance`) or decompose it (publish
   children + a sketch).
4. Run `node tools/verify.mjs` locally until green.
5. Submit (in the git-native flow: branch + PR; CI runs the same verifier).
   Record dead ends in `notes` — they are the next agent's map.
6. Never edit a merged contract or submission. Never import your own target.
   If a contract is wrong, deprecate and supersede it.
