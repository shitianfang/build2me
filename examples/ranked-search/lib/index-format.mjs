// Contract: positional-index — build, persist and open the index.
// (Supersedes contract inverted-index, deprecated when exact-phrase search
// arrived: adjacency cannot be decided from frequencies, only from positions.)
//
// One file, index/index.bin:
//
//   "B2SI" | version:u8 | headerLen:u32le | header:JSON | sections
//
// The JSON header is small and self-describing (counts, caller meta, each
// section's offset RELATIVE to the end of the header, the byte width of each
// offset table, and the front-coding block size) so a later reader can be
// written from the file alone. Format and version live in the 9-byte prefix
// and are not repeated inside it.
//
// Everything bulky is binary, and v3 spends BITS rather than bytes on it:
//
//   postings   binary interpolative coding (BIC). A term's document list is a
//              sorted subset of [0, docCount); its positions inside one
//              document are a sorted subset of [0, span). BIC codes such a
//              subset in ~log2(C(universe, size)) bits — it charges for how
//              CLUSTERED the list is, which is exactly the shape of a real
//              posting list, and it needs no gap, no continuation bit and no
//              per-value byte boundary. Measured: 27 240 -> 18 856 bytes, 4%
//              off the information-theoretic bound for this corpus.
//   dictionary blocked front coding. Terms are sorted, so each one stores only
//              what it does not share with its predecessor; every BLOCK-th
//              term restarts the chain and is the only one an offset table
//              points at. That shrinks the term bytes AND turns two
//              one-entry-per-term offset tables into one-entry-per-block ones
//              (5 197 -> 3 254 bytes). Document ids use the same table, keyed
//              by position instead of searched.
//
// Nothing is decoded until it is asked for: a lookup binary-searches BLOCK
// heads, decodes one block, and reads one posting list.
//
// POSITION SPACE (this is what makes phrase search correct across fields):
// a document's title tokens occupy 0..titleLen-1 and its body tokens start at
// titleLen + 1. Position titleLen is deliberately never used, so the last
// title token and the first body token are never adjacent and no phrase can
// straddle the two fields. A posting's title count is the number of positions
// below titleLen, its body count the rest — which is why titleLen is persisted
// per document. It also bounds the position universe: a document spans
// titleLen + 1 + bodyLen coordinates, and that is what BIC codes against.
// A title occurrence weighs TITLE_WEIGHT both here — via docLen — and in
// scoring.
import fs from 'node:fs';
import path from 'node:path';
import { tokenize } from './analyze.mjs';

export const TITLE_WEIGHT = 5;
const MAGIC = 'B2SI';
const VERSION = 3;          // v1 frequencies, v2 varint positions: refused here on purpose
const FILE = 'index.bin';
const BLOCK = 16;           // front-coded / skip block: one offset entry per BLOCK entries

/** Body token j of a document whose title holds `titleLen` tokens. */
export const bodyPosition = (titleLen, j) => titleLen + 1 + j;

/** Coordinates a document occupies: its title, the boundary gap, its body. */
const docSpan = (len, titleLen) => titleLen + 1 + (len - titleLen * TITLE_WEIGHT);

class ByteWriter {
  constructor() { this.buf = Buffer.allocUnsafe(1 << 16); this.len = 0; this.acc = 0; this.accBits = 0; }
  need(n) {
    if (this.len + n <= this.buf.length) return;
    let size = this.buf.length * 2;
    while (size < this.len + n) size *= 2;
    const grown = Buffer.allocUnsafe(size);
    this.buf.copy(grown, 0, 0, this.len);
    this.buf = grown;
  }
  uint(v, width) { this.need(width); this.buf.writeUIntLE(v, this.len, width); this.len += width; }
  varint(v) {
    this.need(10);
    let x = Math.max(0, Math.trunc(v));
    while (x >= 0x80) { this.buf[this.len++] = (x & 0x7f) | 0x80; x = Math.floor(x / 128); }
    this.buf[this.len++] = x;
  }
  bytes(b) { this.need(b.length); b.copy(this.buf, this.len); this.len += b.length; }
  /** n low bits of v, most significant first. Bits and bytes share the cursor. */
  bits(v, n) {
    let left = n;
    while (left > 0) {
      const take = Math.min(left, 8 - this.accBits);
      left -= take;
      this.acc = ((this.acc << take) | ((v >>> left) & ((1 << take) - 1))) & 0xff;
      this.accBits += take;
      if (this.accBits === 8) { this.need(1); this.buf[this.len++] = this.acc; this.acc = 0; this.accBits = 0; }
    }
  }
  /** Close the bit stream on a byte boundary so the next entry starts clean. */
  align() { if (this.accBits > 0) this.bits(0, 8 - this.accBits); }
  take() { return this.buf.subarray(0, this.len); }
}

class BitReader {
  constructor(buf, at) { this.buf = buf; this.at = at; this.acc = 0; this.n = 0; }
  bits(n) {
    let v = 0;
    let left = n;
    while (left > 0) {
      if (this.n === 0) {
        // Same reason as readVarint's guard: reading past the end yields
        // undefined, every derived bit reads as 0, and a gamma code would loop
        // forever. A damaged index fails loudly instead.
        if (this.at >= this.buf.length) throw new Error('corrupt index: a posting stream runs past the end of the file');
        this.acc = this.buf[this.at++];
        this.n = 8;
      }
      const take = Math.min(left, this.n);
      this.n -= take;
      left -= take;
      v = v * (1 << take) + ((this.acc >> this.n) & ((1 << take) - 1));
    }
    return v;
  }
}

// The cursor comes back out-of-band, in `varintEnd`: returning [value, pos]
// allocates a tuple per integer, and opening an index reads thousands of them.
let varintEnd = 0;
function readVarint(buf, pos) {
  let value = 0;
  let scale = 1;
  for (;;) {
    const b = buf[pos++];
    value += (b & 0x7f) * scale;
    if (b < 0x80) { varintEnd = pos; return value; }
    // Past the end of the file the byte is undefined, `b < 0x80` is false and
    // this loop would spin forever: a damaged index must fail loudly, not hang.
    if (b === undefined) throw new Error('corrupt index: a variable-length integer runs past the end of the file');
    scale *= 128;
  }
}

// Truncated binary: x in [0, r), the first (2^(k+1) - r) values in k bits and
// the rest in k+1. A range that holds one value costs nothing at all, which is
// what makes BIC's implied runs free.
const tbWrite = (w, x, r) => {
  if (r <= 1) return;
  const k = 31 - Math.clz32(r);
  const u = (1 << (k + 1)) - r;
  if (x < u) w.bits(x, k); else w.bits(x + u, k + 1);
};
const tbRead = (rd, r) => {
  if (r <= 1) return 0;
  const k = 31 - Math.clz32(r);
  const u = (1 << (k + 1)) - r;
  const v = rd.bits(k);
  return v < u ? v : (v * 2 + rd.bits(1)) - u;
};

// Elias gamma, for the few values with no useful upper bound (a repeat count).
const gammaWrite = (w, v) => { const b = 32 - Math.clz32(v); w.bits(0, b - 1); w.bits(v, b); };
const gammaRead = (rd) => {
  let z = 0;
  while (rd.bits(1) === 0) z++;
  return z === 0 ? 1 : (1 << z) + rd.bits(z);
};

// Binary interpolative coding of a strictly ascending S[from..to] known to lie
// in [lo, hi]: code the middle element against the tightest range its position
// allows, then recurse on both halves inside the ranges it just split. A run
// that fills its range exactly costs zero bits.
function bicWrite(w, S, from, to, lo, hi) {
  const m = to - from + 1;
  if (m <= 0 || hi - lo + 1 === m) return;
  if (m === 1) { tbWrite(w, S[from] - lo, hi - lo + 1); return; }
  const h = from + (m >> 1);
  const v = S[h];
  const left = h - from;
  const right = to - h;
  tbWrite(w, v - (lo + left), (hi - right) - (lo + left) + 1);
  bicWrite(w, S, from, h - 1, lo, v - 1);
  bicWrite(w, S, h + 1, to, v + 1, hi);
}
function bicRead(rd, out, from, to, lo, hi) {
  const m = to - from + 1;
  if (m <= 0) return;
  if (hi - lo + 1 === m) { for (let i = 0; i < m; i++) out[from + i] = lo + i; return; }
  if (m === 1) { out[from] = lo + tbRead(rd, hi - lo + 1); return; }
  const h = from + (m >> 1);
  const left = h - from;
  const right = to - h;
  const v = (lo + left) + tbRead(rd, (hi - right) - (lo + left) + 1);
  out[h] = v;
  bicRead(rd, out, from, h - 1, lo, v - 1);
  bicRead(rd, out, h + 1, to, v + 1, hi);
}

/** Tokenize every document and accumulate the positional postings, in memory. */
export function buildIndex(docs, meta = {}) {
  const list = Array.isArray(docs) ? docs : [];
  const ids = new Array(list.length);
  const lens = new Array(list.length);
  const titleLens = new Array(list.length);
  const terms = new Map();   // term -> { docs: [], positions: [[...]] }
  let totalLen = 0;

  list.forEach((doc, i) => {
    const title = tokenize(doc.title);
    const body = tokenize(doc.body);
    ids[i] = String(doc.id);
    titleLens[i] = title.length;
    lens[i] = title.length * TITLE_WEIGHT + body.length;
    totalLen += lens[i];
    const at = new Map();   // term -> ascending positions within this document
    const bump = (t, position) => {
      const list_ = at.get(t);
      if (list_) list_.push(position); else at.set(t, [position]);
    };
    title.forEach((t, j) => bump(t, j));
    body.forEach((t, j) => bump(t, bodyPosition(title.length, j)));
    for (const [term, positions] of at) {
      let p = terms.get(term);
      if (!p) { p = { docs: [], positions: [] }; terms.set(term, p); }
      p.docs.push(i);
      p.positions.push(positions);
    }
  });

  return { ids, lens, titleLens, totalLen, terms, meta: meta ?? {} };
}

/**
 * A blocked front-coded table: entry i stores only the bytes it does not share
 * with entry i-1, except every BLOCK-th, which restarts the chain and is the
 * only entry the offset table points at. `payloads` (optional) appends one
 * varint per entry — the term dictionary carries each posting list's byte
 * length there, which is what replaces a per-term offset table.
 */
function writeStringTable(keys, payloads) {
  const bytes = new ByteWriter();
  const offsets = [];
  for (let i = 0; i < keys.length; i++) {
    if (i % BLOCK === 0) {
      offsets.push(bytes.len);
      bytes.varint(keys[i].length);
      bytes.bytes(keys[i]);
    } else {
      const prev = keys[i - 1];
      let shared = 0;
      while (shared < keys[i].length && shared < prev.length && keys[i][shared] === prev[shared]) shared++;
      bytes.varint(shared);
      bytes.varint(keys[i].length - shared);
      bytes.bytes(keys[i].subarray(shared));
    }
    if (payloads) bytes.varint(payloads[i]);
  }
  offsets.push(bytes.len);
  return { bytes, offsets };
}

/** Serialise first, destroy second: a failed serialisation leaves the old index intact. */
export function writeIndex(dir, index) {
  const sorted = [...index.terms.keys()].map((t) => ({ term: t, key: Buffer.from(t, 'utf8') }))
    .sort((a, b) => Buffer.compare(a.key, b.key));

  const docLens = new ByteWriter();
  for (const len of index.lens) docLens.varint(len);
  const docTitleLens = new ByteWriter();
  for (const len of index.titleLens ?? []) docTitleLens.varint(len);
  const spans = index.lens.map((len, i) => docSpan(len, (index.titleLens ?? [])[i] ?? 0));

  // Postings first: the dictionary carries each list's byte length.
  const postBytes = new ByteWriter();
  const postLens = [];
  for (const { term } of sorted) {
    const from = postBytes.len;
    const p = index.terms.get(term);
    const df = p.docs.length;
    postBytes.varint(df);
    bicWrite(postBytes, p.docs, 0, df - 1, 0, index.ids.length - 1);
    // Which postings repeat, then by how much: tf is 1 far more often than not,
    // so the exceptions are coded as a sparse subset of the list rather than as
    // a count per posting.
    const repeats = [];
    for (let i = 0; i < df; i++) if (p.positions[i].length > 1) repeats.push(i);
    tbWrite(postBytes, repeats.length, df + 1);
    if (repeats.length > 0) {
      bicWrite(postBytes, repeats, 0, repeats.length - 1, 0, df - 1);
      for (const i of repeats) gammaWrite(postBytes, p.positions[i].length - 1);
    }
    for (let i = 0; i < df; i++) {
      const at = p.positions[i];
      bicWrite(postBytes, at, 0, at.length - 1, 0, spans[p.docs[i]] - 1);
    }
    postBytes.align();
    postLens.push(postBytes.len - from);
  }

  const docIdTable = writeStringTable(index.ids.map((id) => Buffer.from(id, 'utf8')), null);
  const termTable = writeStringTable(sorted.map((s) => s.key), postLens);
  const postOffsets = [];
  let runningPost = 0;
  for (let i = 0; i < postLens.length; i++) {
    if (i % BLOCK === 0) postOffsets.push(runningPost);
    runningPost += postLens[i];
  }
  postOffsets.push(runningPost);

  // An offset table only needs as many bytes as its largest entry.
  const widthFor = (max) => (max < 0x100 ? 1 : max < 0x10000 ? 2 : max < 0x1000000 ? 3 : 4);
  const table = (offsets) => {
    const width = widthFor(offsets[offsets.length - 1] ?? 0);
    const w = new ByteWriter();
    for (const o of offsets) w.uint(o, width);
    return { writer: w, width };
  };
  const docIdOff = table(docIdTable.offsets);
  const termOff = table(termTable.offsets);
  const postOff = table(postOffsets);

  const sections = [
    ['docIdOff', docIdOff.writer], ['docIdBytes', docIdTable.bytes], ['docLens', docLens], ['docTitleLens', docTitleLens],
    ['termOff', termOff.writer], ['termBytes', termTable.bytes], ['postOff', postOff.writer], ['postBytes', postBytes],
  ];
  const offsets = {};
  let at = 0;
  for (const [name, w] of sections) { offsets[name] = at; at += w.len; }

  const header = Buffer.from(JSON.stringify({
    docCount: index.ids.length, termCount: sorted.length, totalLen: index.totalLen, block: BLOCK,
    meta: index.meta, sections: offsets,
    widths: { docIdOff: docIdOff.width, termOff: termOff.width, postOff: postOff.width },
  }), 'utf8');

  const prefix = Buffer.allocUnsafe(4 + 1 + 4);
  prefix.write(MAGIC, 0, 'latin1');
  prefix.writeUInt8(VERSION, 4);
  prefix.writeUInt32LE(header.length, 5);
  const file = Buffer.concat([prefix, header, ...sections.map(([, w]) => w.take())]);

  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, FILE), file);
}


/** Open an index for reading: header eagerly, everything else on demand. */
export function openIndex(dir) {
  const file = path.join(dir, FILE);
  let buf;
  try {
    buf = fs.readFileSync(file);
  } catch (e) {
    throw new Error(`no index in "${dir}" (${e.code ?? e.message}) — run: node search.mjs index <docs.jsonl>`);
  }
  if (buf.length < 9 || buf.toString('latin1', 0, 4) !== MAGIC) {
    throw new Error(`"${file}" is not a search index: bad magic — the index format is B2SI v${VERSION}`);
  }
  const version = buf.readUInt8(4);
  if (version !== VERSION) throw new Error(`"${file}": index format version ${version}, this build reads v${VERSION} — re-run: node search.mjs index <docs.jsonl>`);
  const headerLen = buf.readUInt32LE(5);
  let header;
  try {
    header = JSON.parse(buf.toString('utf8', 9, 9 + headerLen));
  } catch (e) {
    throw new Error(`"${file}": corrupt index header format (${e.message})`);
  }
  const base = 9 + headerLen;
  const block = header.block ?? BLOCK;
  const docCount = header.docCount;
  const termCount = header.termCount;
  const s = header.sections;
  const at = (name) => base + s[name];
  const offset = (name, i) => buf.readUIntLE(at(name) + i * header.widths[name], header.widths[name]);

  const varintSection = (name) => {
    let decoded = null;
    return () => {
      if (decoded) return decoded;
      decoded = new Float64Array(docCount);
      let pos = at(name);
      for (let i = 0; i < docCount; i++) { decoded[i] = readVarint(buf, pos); pos = varintEnd; }
      return decoded;
    };
  };
  const docLens = varintSection('docLens');
  const docTitleLens = varintSection('docTitleLens');

  // One reusable key buffer serves both front-coded tables: an entry reuses the
  // prefix its predecessor already left in place, so a block scan copies only
  // the suffix bytes and allocates nothing per entry.
  let keyBuf = Buffer.allocUnsafe(256);
  /**
   * Walk block `b` of a blocked front-coded table, calling
   * visit(keyLength, entryIndex, payload) with the bytes in `keyBuf`; returning
   * true stops the walk. The only decoder of that layout: document ids
   * materialise strings from it, the term dictionary compares in place.
   */
  const scanBlock = (section, offName, b, count, withPayload, visit) => {
    let pos = at(section) + offset(offName, b);
    const first = b * block;
    const n = Math.min(block, count - first);
    for (let i = 0; i < n; i++) {
      let shared = 0;
      if (i > 0) { shared = readVarint(buf, pos); pos = varintEnd; }
      const len = readVarint(buf, pos);
      pos = varintEnd;
      if (shared + len > keyBuf.length) {
        const grown = Buffer.allocUnsafe(Math.max(keyBuf.length * 2, shared + len));
        keyBuf.copy(grown, 0, 0, shared);
        keyBuf = grown;
      }
      buf.copy(keyBuf, shared, pos, pos + len);
      pos += len;
      let payload = 0;
      if (withPayload) { payload = readVarint(buf, pos); pos = varintEnd; }
      if (visit(shared + len, first + i, payload)) return;
    }
  };
  const compareKey = (len, key) => {
    const n = len < key.length ? len : key.length;
    for (let i = 0; i < n; i++) { const d = keyBuf[i] - key[i]; if (d !== 0) return d; }
    return len - key.length;
  };

  const termBlocks = Math.ceil(termCount / block);
  /** cmp(the head term of block b, key), without materialising the head. */
  const compareHead = (b, key) => {
    const len = readVarint(buf, at('termBytes') + offset('termOff', b));
    return buf.compare(key, 0, key.length, varintEnd, varintEnd + len);
  };

  /**
   * Byte offset of `key`'s posting list inside postBytes, or -1 if the term is
   * unknown. Binary search over block heads, then one block scan, adding up the
   * posting-list lengths the dictionary carries — that payload is what lets the
   * offset table hold one entry per BLOCK terms instead of one per term.
   */
  const findPostings = (key) => {
    if (termCount === 0) return -1;
    let lo = 0;
    let hi = termBlocks - 1;
    let target = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const cmp = compareHead(mid, key);
      if (cmp === 0) return offset('postOff', mid);
      if (cmp < 0) { target = mid; lo = mid + 1; } else hi = mid - 1;
    }
    if (target === -1) return -1;                        // below the first term
    let off = offset('postOff', target);
    let found = -1;
    scanBlock('termBytes', 'termOff', target, termCount, true, (len, _entry, payload) => {
      const cmp = compareKey(len, key);
      if (cmp === 0) { found = off; return true; }
      if (cmp > 0) return true;                          // terms ascend: past it
      off += payload;
      return false;
    });
    return found;
  };

  const decodePostings = (key) => {
    const start = findPostings(key);
    if (start === -1) return [];
    const df = readVarint(buf, at('postBytes') + start);
    const rd = new BitReader(buf, varintEnd);
    const docs = new Array(df);
    bicRead(rd, docs, 0, df - 1, 0, docCount - 1);
    // Which postings repeat, then by how much: tf is 1 far more often than not,
    // so the exceptions are a sparse subset of the list, not a count per posting.
    const tfs = new Array(df).fill(1);
    const repeated = tbRead(rd, df + 1);
    if (repeated > 0) {
      const which = new Array(repeated);
      bicRead(rd, which, 0, repeated - 1, 0, df - 1);
      for (let i = 0; i < repeated; i++) tfs[which[i]] = 1 + gammaRead(rd);
    }
    const lens = docLens();
    const titleLens = docTitleLens();
    const out = new Array(df);
    for (let k = 0; k < df; k++) {
      const doc = docs[k];
      const tf = tfs[k];
      const titleLen = titleLens[doc];
      const positions = new Array(tf);
      bicRead(rd, positions, 0, tf - 1, 0, docSpan(lens[doc], titleLen) - 1);
      // Title and body counts are read off the positions: everything below the
      // title length is a title occurrence, everything above it a body one.
      let title = 0;
      while (title < tf && positions[title] < titleLen) title++;
      out[k] = { doc, body: tf - title, title, positions };
    }
    return out;
  };

  // One decode per term per process: bm25-ranking and phrase-matching ask for
  // the same terms, and a query process is judged on wall-clock time.
  const decoded = new Map();
  const docIdBlocks = [];

  return {
    docCount,
    termCount,
    meta: header.meta ?? {},
    avgDocLen: docCount > 0 ? header.totalLen / docCount : 0,
    docId(i) {
      if (!(i >= 0 && i < docCount)) return undefined;
      const b = Math.floor(i / block);
      let ids = docIdBlocks[b];
      if (ids === undefined) {
        ids = [];
        scanBlock('docIdBytes', 'docIdOff', b, docCount, false, (len) => { ids.push(keyBuf.toString('utf8', 0, len)); return false; });
        docIdBlocks[b] = ids;
      }
      return ids[i - b * block];
    },
    docLen(i) { return docLens()[i] ?? 0; },
    docTitleLen(i) { return docTitleLens()[i] ?? 0; },
    postings(term) {
      const tokens = tokenize(term);
      if (tokens.length !== 1) return [];
      const known = decoded.get(tokens[0]);
      if (known !== undefined) return known;
      const out = decodePostings(Buffer.from(tokens[0], 'utf8'));
      decoded.set(tokens[0], out);
      return out;
    },
  };
}
