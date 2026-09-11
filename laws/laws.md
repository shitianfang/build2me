# Laws

Laws are this project's axiom system: the rules every submission must conform to.
Conformance to a law is a Lean-grade check — instant and argument-free — *relative
to the law as written*. Laws themselves are amended by humans, via ordinary
reviewed commits; git history is the law's version history.

- **L1 — zero runtime dependencies.** `tools/` must run on plain Node >= 20.
  Enforced by the verifier (a `package.json` with dependencies fails the build).
- **L2 — contracts are immutable.** Contract files may only be added, never
  modified or deleted. Enforced by `tools/check-immutability.sh` in CI.
  To change a contract: deprecate it (append to `laws/deprecations.log`) and
  publish a successor under a new name.
- **L3 — deprecations.log is append-only.** Enforced by `tools/check-immutability.sh`.
- **L4 — English.** Code, comments, contracts, and docs are written in English.
