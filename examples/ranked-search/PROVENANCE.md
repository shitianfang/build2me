# Provenance

This directory is the final state of bench 002's protocol arm — a ranked
full-text search CLI built in three rounds, each by a FRESH Opus agent with
no memory of the previous one, entirely under the build2me protocol. It is
the repository's worked example of the whole protocol lifecycle on a real
program: decomposition, red-first gates, a mid-task requirement change
handled by deprecate-and-supersede (7 done / 3 deprecated), laws tightened
with receipts (index-size 0.32 -> 0.38 -> 0.26), and a frontier that ends
empty. `node tools/verify.mjs --dir examples/ranked-search` (from the repo
root: green). The measured comparison against a plain agent session is in
`bench/002-ranked-search/results.md`.
