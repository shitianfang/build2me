// Contract: bm25-ranking — the relevance half of the engine.
//
// BM25 over an inverted-index reader, with two deliberate departures from the
// textbook, both aimed at the judged metric (P@10 against labelled relevant
// sets):
//
//  1. Fields. A term in the title is worth titleWeight body occurrences, and
//     the persisted document length counts title tokens the same way, so the
//     boost survives length normalisation instead of being cancelled by it.
//  2. Coverage. The spec ranks by how well a document matches ALL query terms.
//     A plain BM25 sum lets one rare term dominate, so a document that hits
//     three of three query terms can lose to one that hammers a single term.
//     The final score is multiplied by (covered idf / coverable idf)^COVERAGE.
//     Coverage is weighted by idf, not by term count, for a reason the bench
//     caught: with a plain count, a query of one signature term plus two
//     corpus-wide common words demotes the documents the query is about
//     (bench type "noisy", recall@10 0.78 vs 1.00). Missing a term nobody
//     discriminates on should cost almost nothing; missing a rare one should
//     cost a lot. `coverable` sums only the terms the index has ever seen, so
//     an unknown term (a typo, or judged vocabulary we never indexed) cannot
//     punish every document equally.
//
// Pure: it reads nothing but the reader interface, so it is testable against a
// hand-built reader and reusable over any store that implements it.

// The tuned constants. They are exported and overridable so bench/sweep.mjs can
// explore the space against the SAME scoring code — a tuner that reimplements
// the formula tunes something else.
export const PARAMS = {
  k1: 0.9,            // term-frequency saturation
  b: 0.6,             // length-normalisation strength
  titleWeight: 2,     // a title occurrence counts as two body occurrences
  coverage: 1,        // exponent on the covered share of the query's idf mass
};

export function rank(reader, queryTerms, limit = 10, params = PARAMS) {
  const { k1: K1, b: B, titleWeight: TITLE_WEIGHT, coverage: COVERAGE } = { ...PARAMS, ...params };
  const terms = [...new Set((queryTerms ?? []).filter((t) => typeof t === 'string' && t !== ''))];
  const total = reader?.docCount ?? 0;
  if (terms.length === 0 || total === 0) return [];
  const avgLen = reader.avgDocLen > 0 ? reader.avgDocLen : 1;

  const hits = new Map();  // doc index -> { score, covered }
  let coverable = 0;       // total idf mass of the query terms the index knows
  for (const term of terms) {
    const postings = reader.postings(term);
    if (postings.length === 0) continue;
    const idf = Math.log(1 + (total - postings.length + 0.5) / (postings.length + 0.5));
    coverable += idf;
    for (const p of postings) {
      const tf = p.body + TITLE_WEIGHT * p.title;
      if (tf <= 0) continue;
      const len = reader.docLen(p.doc) || avgLen;
      const score = idf * (tf * (K1 + 1)) / (tf + K1 * (1 - B + B * (len / avgLen)));
      const hit = hits.get(p.doc);
      if (hit) { hit.score += score; hit.covered += idf; } else hits.set(p.doc, { score, covered: idf });
    }
  }
  if (coverable === 0) return [];

  const scored = [];
  for (const [doc, hit] of hits) {
    const coverage = hit.covered >= coverable ? 1 : (hit.covered / coverable) ** COVERAGE;
    const score = hit.score * coverage;
    if (score > 0) scored.push({ id: reader.docId(doc), score });
  }
  scored.sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const out = [];
  const seen = new Set();
  for (const { id } of scored) {
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= limit) break;
  }
  return out;
}
