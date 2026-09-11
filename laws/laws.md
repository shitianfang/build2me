# Laws

One enforced floor per quality dimension. A law is only a law if something
enforces it; prose without a check is advice. Which dimensions this project
holds was not decided up front — each law below was added when a real problem
bit, with its floor set at the level measured that day.

Built into the kernel and CI:

- **L1 — zero runtime dependencies.** `tools/` runs on plain Node >= 20.
  Enforced by the verifier (a `package.json` with dependencies fails).
- **L2 — contracts are immutable.** Add-only; enforced by
  `tools/check-immutability.sh` in CI. To change one: deprecate and publish a
  successor.
- **L3 — deprecations.log is append-only.** Same script.

Declared as objects (`laws/<id>.json`, run by the verifier on every pass):

- **l4-english** (legibility) — code, contracts and gates carry no CJK; docs
  are exempt. Was prose-only until the audit found it unenforced.
- **l5-tool-size** (complexity) — no kernel tool exceeds 400 lines. Floor set
  above the largest tool of the day (serve.mjs, 327).
- **l6-status-honest** (docs) — each README's "N / M contracts Done" line must
  equal the derived DAG status. The hand-typed line went stale twice in the
  repo's first day.

To add one: measure where you stand, write `laws/<id>.json` with
`{id, dimension, statement, check}`, and tighten the floor deliberately when
you have margin. A check must never invoke `verify.mjs` — verify runs the
laws, so it would re-enter (l6 uses `graph.mjs --structural` for exactly that
reason).
