// Contract: corpus-reader — flawed JSONL in, usable documents plus an exact
// skip count out.
//
// Read in 64 KB chunks through a StringDecoder rather than readFileSync: a
// corpus is the one input whose size we do not control, and a multi-byte
// character landing on a chunk boundary must not corrupt a line. The only
// thing that throws is an unopenable path; malformed CONTENT is data, not an
// error, and is what `skipped` counts.
import fs from 'node:fs';
import { StringDecoder } from 'node:string_decoder';

const CHUNK = 1 << 16;
const BLANK = /^\s*$/;

export function readCorpus(file) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
  } catch (e) {
    throw new Error(`cannot read corpus "${file}": ${e.code ?? e.message}`);
  }

  const docs = [];
  let skipped = 0;
  const take = (raw) => {
    // A corpus line is a non-blank line; \r from a CRLF file is not content.
    const line = raw.charCodeAt(raw.length - 1) === 13 ? raw.slice(0, -1) : raw;
    if (BLANK.test(line)) return;
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      skipped++;
      return;
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      skipped++;
      return;
    }
    const { id, title, body } = parsed;
    if (typeof id !== 'string' || typeof title !== 'string' || typeof body !== 'string') {
      skipped++;
      return;
    }
    docs.push({ id, title, body });
  };

  const buf = Buffer.allocUnsafe(CHUNK);
  const decoder = new StringDecoder('utf8');
  let pending = '';
  try {
    for (;;) {
      const n = fs.readSync(fd, buf, 0, CHUNK, null);
      if (n === 0) break;
      pending += decoder.write(buf.subarray(0, n));
      let nl = pending.indexOf('\n');
      if (nl === -1) continue;
      let from = 0;
      while (nl !== -1) {
        take(pending.slice(from, nl));
        from = nl + 1;
        nl = pending.indexOf('\n', from);
      }
      pending = pending.slice(from);
    }
  } finally {
    fs.closeSync(fd);
  }
  pending += decoder.end();
  take(pending);

  return { docs, skipped };
}
