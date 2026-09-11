# Bench 001 — closed before phase 2 (superseded by bench 002)

The owner judged the markdown-converter task too one-dimensional to be the
flagship example: it exercises cold continuation but none of the protocol's
quality dimensions (laws, floors, deprecation). Superseded by bench 002
(ranked search), whose rounds each start with a fresh memoryless agent — so
the cold-continuation question is contained in 002 rather than dropped.

Recorded phase-1 numbers (both arms completed, snapshots kept):

| arm | tokens | tool uses | wall time | end state |
|---|---|---|---|---|
| P (protocol) | 120,395 | 30 | 13.6 min | verify green: 3 done / 4 open, 7 gates run red-first, decomposition submitted |
| C (plain) | 52,187 | 10 | 4.2 min | features 1-3 + tests green, README handoff, skipped tests marking remaining work |

First honest data point: the protocol's phase-1 overhead was ~2.3x tokens.
Whether that overhead buys anything is exactly what 002 measures.
