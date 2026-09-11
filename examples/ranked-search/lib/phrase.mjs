// Contract: phrase-matching — which documents contain a quoted phrase.
//
// Exact-phrase search is a FILTER, not a second scorer: `"alpha beta gamma"`
// restricts the answer to the documents where those tokens occur adjacent and
// in order, and bm25-ranking then orders that restricted set exactly as it
// orders anything else. Keeping the two apart is what makes the feature cheap:
// relevance tuning stays in one place, and a phrase query is the same ranking
// with a smaller candidate set.
//
// Two rules earn their own explanation:
//
//  1. A quote that is never closed is NOT a phrase. Silently promoting a
//     half-quoted query to a phrase would turn a stray character into a
//     recall cliff; leaving it loose degrades to the ordinary behaviour the
//     user already had.
//  2. Adjacency is decided in the index's position space, where a document's
//     title occupies 0..titleLen-1 and its body starts at titleLen + 1. The
//     skipped position is the field boundary: "last word of the title" and
//     "first word of the body" are never adjacent, so no phrase can straddle
//     the two fields.
//
// Pure: it reads nothing but the reader interface (docCount, docId, postings
// with positions), so it is testable against a hand-built reader.
import { tokenize } from './analyze.mjs';

/**
 * The closed double-quoted segments of a raw query, each tokenized with the
 * shared analyzer. Unquoted text and unterminated quotes yield nothing; an
 * empty or punctuation-only quote ("" or " - ") is dropped, not treated as an
 * unsatisfiable phrase.
 */
export function quotedPhrases(raw) {
  if (typeof raw !== 'string') return [];
  const phrases = [];
  let from = raw.indexOf('"');
  while (from !== -1) {
    const close = raw.indexOf('"', from + 1);
    if (close === -1) break;            // unterminated: not a phrase
    const terms = tokenize(raw.slice(from + 1, close));
    if (terms.length > 0) phrases.push(terms);
    from = raw.indexOf('"', close + 1);
  }
  return phrases;
}

/**
 * Document indices (ascending) where `terms` occur adjacent and in order.
 * A one-term phrase is just the term's postings; an empty phrase, or one
 * naming a term the index has never seen, matches nothing.
 */
export function phraseDocs(reader, terms) {
  const phrase = (terms ?? []).filter((t) => typeof t === 'string' && t !== '');
  if (phrase.length === 0 || !reader || (reader.docCount ?? 0) === 0) return [];

  // Start from the rarest term: the candidate set can only shrink, so the
  // fewest postings up front means the fewest position walks afterwards.
  const lists = phrase.map((term, i) => ({ i, postings: reader.postings(term) ?? [] }));
  if (lists.some((l) => l.postings.length === 0)) return [];
  const rarest = lists.reduce((a, b) => (b.postings.length < a.postings.length ? b : a));
  const others = lists.filter((l) => l !== rarest)
    .map((l) => ({ i: l.i, byDoc: new Map(l.postings.map((p) => [p.doc, p.positions ?? []])) }));

  const out = [];
  for (const seed of rarest.postings) {
    // Every other term must appear in this document, offset by its distance
    // from the anchor term.
    const elsewhere = [];
    for (const other of others) {
      const positions = other.byDoc.get(seed.doc);
      if (positions === undefined) { elsewhere.length = 0; break; }
      elsewhere.push([other.i, positions]);
    }
    if (elsewhere.length !== others.length) continue;
    const matches = (seed.positions ?? []).some((p) => {
      const start = p - rarest.i;   // where the phrase would have to begin
      return elsewhere.every(([i, positions]) => positions.includes(start + i));
    });
    if (matches) out.push(seed.doc);
  }
  return out.sort((a, b) => a - b);
}

/**
 * The ids of the documents satisfying EVERY phrase, or null when there is no
 * phrase to satisfy — null is "do not restrict anything", which is what an
 * ordinary unquoted query passes down, and is deliberately not the same as the
 * empty set ("nothing can match").
 */
export function phraseDocIds(reader, phrases) {
  const list = (phrases ?? []).filter((p) => Array.isArray(p) && p.length > 0);
  if (list.length === 0) return null;
  let docs = null;
  for (const phrase of list) {
    const matched = new Set(phraseDocs(reader, phrase));
    docs = docs === null ? matched : new Set([...docs].filter((d) => matched.has(d)));
    if (docs.size === 0) break;
  }
  return new Set([...docs].map((d) => reader.docId(d)).filter((id) => id !== undefined));
}
