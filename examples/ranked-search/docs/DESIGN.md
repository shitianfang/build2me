# ranked-search — how the parts fit

`search.mjs` is a thin CLI over five libraries, one per contract. Read
`contracts/*.json` for the statements; this file is the map.

```
search.mjs            search-cli-phrases  argv -> command, ./index resolved against cwd, output format, exit codes
  lib/corpus.mjs      corpus-reader       JSONL in -> {docs, skipped}; malformed content is data, not an error
  lib/analyze.mjs     text-analyzer       the ONE tokenizer: lowercase, fold diacritics, [a-z0-9]+ runs
  lib/index-format.mjs positional-index   buildIndex / writeIndex / openIndex over one binary file, positions included
  lib/rank.mjs        bm25-ranking        BM25 + field weighting + idf-weighted coverage, over a reader interface
  lib/phrase.mjs      phrase-matching     quoted segments -> the documents where those words are adjacent
```

Dependencies point one way only: `rank` and `phrase` never touch the
filesystem (they take any object with the reader interface, which is why their
gates can hand them a hand-built one), `index-format` knows nothing about the
CLI, and the CLI holds no parsing, tokenizing, encoding, matching or scoring
logic of its own. Two gates enforce that structurally: text-analyzer's last
test fails if any other source declares a token character class, and the CLI's
last test fails if search.mjs stops importing a library, grows past ~120 lines
of code, or starts doing adjacency itself.

A query is one path with one optional extra step:

```
  "alpha beta" gamma
      |                quotedPhrases  -> [['alpha','beta']]        (closed quotes only)
      |                tokenize       -> ['alpha','beta','gamma']  (everything, quotes are separators)
      |                rank           -> every document, best first, global idf
      +--------------> phraseDocIds   -> the ids allowed through, or null for "no phrase"
                       filter + slice -> ten ids
```

The filter runs AFTER the ranking on purpose. Restricting the reader first
would make idf local to the candidate set — where a corpus-wide common word
looks rare — and silently re-order the phrase results.

## index/index.bin

`"B2SI" | version:u8 | headerLen:u32le | header:JSON | sections` (v3). The JSON
header carries counts, the caller's `meta` (docs, skipped — that is how `stats`
answers without re-reading the corpus), each section's offset relative to the
end of the header, the byte width of each offset table, and the front-coding
block size. Format and version are in the 9-byte prefix, not repeated inside it.

Sections: document ids, document lengths (varint), document TITLE lengths
(varint), the term dictionary sorted by UTF-8 bytes, and the postings. Two
encodings carry the whole file, and both spend BITS rather than bytes:

**Postings — binary interpolative coding.** A term's document list is a sorted
subset of `[0, docCount)`; its positions inside one document are a sorted
subset of `[0, span)`. BIC codes such a subset by writing its MIDDLE element
against the tightest range its rank allows (truncated binary), then recursing
into the two ranges that element just split — a stretch that fills its range
exactly costs zero bits. It charges for how CLUSTERED a list is, which is the
real shape of postings, and it needs no gaps, no continuation bits and no byte
boundaries. Per term: a varint df, then one bit stream —

```
  BIC(docs in [0,docCount))  |  tb(#repeats) + BIC(their slots) + gamma(tf-1)…  |  BIC(positions in [0,span)) per doc
```

tf is not stored per posting: 9 174 of 10 753 postings here hold a single
occurrence, so the exceptions are coded as a sparse subset of the list instead.

**Dictionary and document ids — blocked front coding.** Terms are sorted, so
each stores only what it does not share with its predecessor; every 16th entry
restarts the chain and is the only one the offset table points at. Each term
also carries its posting list's byte LENGTH, which is what lets one offset per
block replace a per-term offset table: binary-search the block heads, scan the
block, add up lengths. Document ids use the same table, addressed by position.

Nothing is decoded until it is asked for, so a query pays for the terms it
names, not for the corpus; postings are memoised per process, because a phrase
query asks for the same terms twice (once to match, once to rank). Frequencies
are not stored at all: tf is the number of positions, and title/body is read off
the positions against the document's title length.

v1 and v2 are refused by `openIndex`, not misread, and a varint or bit stream
that runs past the end of the file throws instead of looping on undefined bytes.

**The position space is the phrase feature.** Title token j sits at position
j; body token j sits at `titleLen + 1 + j`. Position `titleLen` is never
occupied, so the last title token and the first body token are two apart and
no phrase can straddle the two fields — the rule falls out of the coordinate
system instead of being a special case in the matcher. It is also the position
universe BIC codes against, which is why `titleLen` is persisted per document.

## The measured dimensions

`node bench/measure.mjs` prints all four; each declared law in `laws/` asserts
one of them through the same script, so the numbers in a law and the numbers in
a report can never drift apart.

| dimension | level held (sample-docs.jsonl) | law |
|---|---|---|
| size | indexBytes/corpusBytes = 0.2548 (23 403 bytes) | `laws/index-size.json` (<= 0.26) |
| speed | startupRatio 1.19-1.26; p95 ~85-112 ms, of which ~52-64 ms is node start-up | `laws/query-latency.json` (<= 1.32, p95 <= 150 ms) |
| robustness | 120 indexed, 5 skipped, exit 0 | `laws/corpus-robustness.json` (exact) |
| relevance | mean recall@10 0.8533, mean P@10 0.2560 over 200 labelled queries | `laws/relevance-floor.json` |
| phrase | precision 1.0 and recall 1.0 over 539 labelled phrase queries | `laws/phrase-exactness.json` (exact) |

`startupRatio` is the fastest measured query divided by the fastest empty
`node -e 0` run beside it. Most of a query process is node booting, so on a
shared machine the millisecond numbers mostly measure the neighbours; the ratio
survives load that stretches both processes, and is what the speed law asserts.

The judged queries are hidden, so `bench/queries.json` is a proxy generated
from the corpus by `bench/make-queries.mjs`: ids are `<topic>-<n>`, documents of
one topic share vocabulary that is rare elsewhere, so relevant set = the topic.
Five query kinds per topic (`sig1`, `sig2`, `mid`, `noisy`, `mix`) of rising
difficulty. Regenerate after changing the analyzer; retune with
`node bench/sweep.mjs`, which drives the real `rank()` over a parameter grid.

The same file carries `phraseQueries`: 539 quoted queries lifted out of the
corpus and labelled by a brute-force adjacency scan that knows nothing about
the index. 333 of them match NOTHING on purpose — reversed pairs, pairs
straddling the title/body boundary, words far apart in one document — because
a filter that never filters scores perfectly on matching phrases alone.

## What the bench already taught us (don't re-learn it)

- **Coverage must be idf-weighted.** Scaling by the *count* of matched query
  terms (`(matched/known)^2.5`) sank the `noisy` kind from 1.00 to 0.78 recall:
  a query of one signature term plus two corpus-wide common words demoted the
  very documents it was about. Weighting coverage by idf mass fixes it at every
  exponent, because missing a term nobody discriminates on now costs nothing.
- **The grid is flat.** k1 0.6-2.0, b 0.2-0.9 and titleWeight 1-8 move mean
  recall@10 by under one percentage point on this corpus; coverage is the only
  parameter with a visible effect. Do not read a 0.3% bench win as a real one.
- **No stemming, no stop words.** The corpus is synthetic and language-neutral;
  both tricks would be guesses about a language we cannot see.
- **Positions are not free, and the encoding is where that is paid.** A naive
  positional index (docGap | tf | positions) measured 0.4725 of the corpus;
  folding "tf is 1" into the low bit of the document gap took it to 0.3727;
  spending the same information in BITS (BIC + front coding, round 3) took it
  to 0.2548, below the pre-positions level. Measured and rejected on the way:
  a forward index of term ids per token, a continuation-bit position stream,
  Elias gamma over the whole value stream (28 388 bytes — WORSE than the
  varints it replaced), and per-list or per-block fixed bit widths (23 301 and
  23 193 bytes of postings, against BIC's 18 856), because the widest value in
  a list sets the price for every value in it.
- **Size is now within ~17% of the bound.** Sum log2 C(universe, size) over
  every document list and every position list and this corpus cannot go below
  16 161 bytes of postings with per-list random access; we are at 18 856.
  Beating that needs context modelling across terms, which costs exactly the
  property that keeps a query cheap: paying only for the terms it names.
- **Most of a query is node, so measure the difference, not the number.**
  p95 in milliseconds moved 85-227 ms on this machine with no code change.
  Timing an empty `node -e 0` beside every query turns the same runs into a
  ratio that holds still. Of the ~11 ms this program adds to an empty process:
  ~3 ms is loading an ES module entry at all, ~1.9 ms is `node:fs`, ~2.6 ms is
  the four libraries a query calls, ~0.9 ms is reading and opening the index,
  ~1.9 ms is decoding postings and scoring. Everything cut in round 3 came off
  the list beside those: an unnecessary `node:process` import (~3 ms), modules
  a command never calls (~1.4 ms), and building a WriteStream to print ten
  lines (~0.7 ms, replaced by `fs.writeSync` to fd 1).
- **Filter after ranking, never before.** Ranking inside the phrase-matched set
  computes idf locally, where common words look rare, and re-orders the answer.
- `bench/mutate.mjs` breaks one thing at a time and checks that the owning
  contract's OWN acceptance command (read from `contracts/<name>.json`, so a
  successor's gate includes its predecessor's) goes red. It found two gates
  that passed on a broken scorer. Run it after touching `lib/`; add a mutant
  when you add behaviour worth gating.

## Working here

`node tools/verify.mjs` runs every gate and every law — that is the only
verdict. `node tools/frontier.mjs` says what is actionable. Contracts and
merged submissions are immutable: to change one, append to
`laws/deprecations.log` and publish a successor. `.tmp/` and `index/` are
scratch; everything a gate needs is committed.

## Round 2: how a changed requirement moved through this project

Exact-phrase search arrived after everything was Done. Three statements had
become wrong, so three contracts were deprecated and superseded — never edited:

| deprecated | successor | why |
|---|---|---|
| `inverted-index` | `positional-index` | `{doc,body,title}` postings cannot express adjacency |
| `search-cli` | `search-cli-phrases` | quoting is new surface on `query` |
| `ranked-search` | `ranked-phrase-search` | the deliverable itself gained a behaviour |

`corpus-reader` and `text-analyzer` were untouched. `bm25-ranking` kept its
statement and was only RE-POINTED: a new submission importing
`positional-index` replaces the one importing the deprecated contract, which
is the protocol's reverse cascade repair. `phrase-matching` is the one new
child.

**Every successor's acceptance runs its predecessor's gate as well as its
own.** That is the no-regression rule made structural rather than promised:
the deprecated contracts' assertions are still executing, inside the
successors' gates, on every verify.

## Round 3: two dimensions moved, nothing was deprecated

No requirement changed, so no statement did either. Round 3 is two better
implementations of contracts that already existed, published as new submissions
beside the ones they supersede (`impl/positional-index/bit-interpolative`,
`impl/search-cli-phrases/lazy-dispatch-phrases`, and
`impl/ranked-phrase-search/round3-density-and-latency` for the bench and this
document). Read their `notes` for the measurements; the short version:

| dimension | before | after |
|---|---|---|
| size | 0.3727 (34 224 bytes) | **0.2548 (23 403 bytes)** |
| speed | startupRatio 1.28-1.45, ~18 ms above an empty node process | **1.19-1.26, ~11 ms** |
| relevance | meanP10 0.2560 / meanRecall10 0.8533 | unchanged, to four decimals |
| phrase | precision 1.0 / recall 1.0 | unchanged |
| robustness | 120 / 5 / exit 0 | unchanged |

The three unchanged rows are the point, not a footnote: the encoding is
lossless and the CLI change only decides which modules get parsed, so neither
can move an answer. It was checked rather than argued — the same 30 queries
through the old binary and the new one, byte-identical stdout.

Both laws that moved were tightened onto what was actually gained:
`laws/index-size.json` 0.38 -> 0.26, and `laws/query-latency.json` onto
`startupRatio` after `bench/measure.mjs` learned to time an empty node process
beside every query. That second one is the round's transferable lesson — when a
floor cannot be tightened because the measurement is noisy, fix the measurement,
not the floor.
