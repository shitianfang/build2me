# Race 001 — deprecation-cascade

Three independent agents, three isolated working copies, one immutable
contract, one fixed acceptance gate published before any attempt. This file's
rubric section was committed **before** any solution was examined; results are
appended afterwards.

## Pre-registered evaluation protocol

Binary gate first: a solution that fails `acceptance/deprecation-cascade.test.mjs`
(clean environment) is out, regardless of any other quality.

Solutions passing the gate are compared **pairwise, blind** (labeled A/B/C, no
authorship metadata) by a judge given only this rubric. Per research on
LLM-as-judge reliability, only rankings are consumed — never absolute scores —
and every preference must cite evidence from the code.

Rubric (each item answered per pair, "which solution, and why"):

1. **Error legibility** — do error messages name the real cause and the
   concrete remedy, so a user (or agent) can self-correct without reading the
   source?
2. **Simplicity** — fewest concepts that satisfy the contract; no speculative
   options, no dead code, no cleverness the spec doesn't demand.
3. **House style** — consistency with the existing `tools/*.mjs`: naming,
   argument parsing shape, comment discipline (constraints only, no narration).
4. **Cheap robustness** — edge behavior beyond the gate where it costs little:
   log file missing or lacking a trailing newline, reasons containing spaces,
   deprecating a contract that is an import of many submissions.
5. **Output design** — is the dependent report readable by a human AND stable
   enough for a script to consume?

Objective metrics recorded per solution (not rank-deciding on their own, but
tie-breaking and trend data): gate pass/fail, lines of code, gate wall-clock.

Winner is merged as `impl/deprecation-cascade/sub-001`; every losing attempt is
preserved in full on the `attempts/deprecation-cascade` branch — failed and
superseded work stays searchable.

## Gate erratum (found during the race)

The fixture `acceptance/fixtures/demo/` shipped without `laws/deprecations.log`,
which tests 1, 2 and 4 of the gate read *before* invoking the tool — making the
gate unpassable as published. Racer B diagnosed this correctly and disclosed a
minimal fixture addition (the header-only log file). The captain applied the
same fix canonically in main. Protocol lesson recorded: a gate must be
**executed against a reference no-op before publication** — a statement nobody
could ever satisfy is a defect of the statement, and in this protocol statement
defects are the captain's to repair, not each racer's to discover.

## Results

All three solutions passed the fixed gate, independently re-verified by the
captain in clean environments. Objective metrics were a three-way tie:

| blind label | gate | LOC | gate wall-clock |
|---|---|---|---|
| X | pass | 132 | 772 ms |
| Y | pass | 127 | 795 ms |
| Z | pass | 134 | 784 ms |

**Blind ranking: 1st Y, 2nd X, 3rd Z.** What separated them was not style but
trustworthiness of the report: the judge found a real defect (D1) in X and Z —
a legal contract name containing whitespace makes both print success while
writing a log line the engine reads back as a different name, silently voiding
the deprecation and bypassing the deprecate-once invariant the gate itself
tests. Y alone rejects the name before writing. The captain reproduced D1 on
both implementations before accepting the verdict. Secondary findings: Z
misreported `--reason=x` as an unknown option and asserted a corrupt-but-present
contract file "does not exist"; X rejected a legal reason starting with `-`
(accurately, with a working escape hatch). Full pairwise evidence per rubric
item is preserved on the attempts branch.

Y is merged as `impl/deprecation-cascade/sub-001`. Captain follow-up applied on
top, per the judge's closing recommendation: a `#`-prefix guard and a
post-append read-back verification (`loadProject().deprecated` must contain the
name, else exit 2) — one check that closes every log-syntax trap at once.

The judge's remaining observation stands as future work: the log format itself
cannot represent names with whitespace or a leading `#`; a stricter contract
name grammar at publish time would remove the trap category entirely.

Label reveal (captain's record): X = racer B, Y = racer C, Z = racer A.
