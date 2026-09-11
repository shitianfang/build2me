// Contract: text-analyzer — the project's ONE tokenizer.
// Indexing and querying both come through here, which is what guarantees a
// document term and a query term are the same string or neither exists.
// Deliberately conservative: no stemming, no stop-word list. The corpus this
// serves is domain-neutral, and both tricks trade recall for guesses about a
// language we do not know we are reading.

const TOKEN = /[a-z0-9]+/g;
const COMBINING_MARKS = /[̀-ͯ]/g;

/** Lowercase, fold diacritics, and emit the maximal alphanumeric runs. */
export function tokenize(text) {
  if (typeof text !== 'string' || text === '') return [];
  const folded = text.toLowerCase().normalize('NFD').replace(COMBINING_MARKS, '');
  return folded.match(TOKEN) ?? [];
}
