// L4 — English: code, contracts and gates carry no CJK text. Docs (README,
// races, laws prose) are exempt: the law guards what agents build against,
// not what humans read.
import fs from 'node:fs';
import path from 'node:path';

const roots = [
  ['tools', (f) => f.endsWith('.mjs') || f.endsWith('.sh')],
  ['acceptance', (f) => f.endsWith('.test.mjs')],
  ['contracts', (f) => f.endsWith('.json')],
  ['laws/checks', (f) => f.endsWith('.mjs')],
];
const offenders = [];
for (const [dir, keep] of roots) {
  if (!fs.existsSync(dir)) continue;
  for (const f of fs.readdirSync(dir).filter(keep)) {
    const p = path.join(dir, f);
    if (!fs.statSync(p).isFile()) continue;
    if (/[\u4e00-\u9fff]/.test(fs.readFileSync(p, 'utf8'))) offenders.push(p);
  }
}
if (offenders.length > 0) {
  console.error(`CJK text in code paths: ${offenders.join(', ')}`);
  process.exit(1);
}
