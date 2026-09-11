// L5 — complexity floor: no single kernel tool exceeds 400 lines. The floor
// sits above today's largest tool (serve.mjs, ~327): held ground, with room.
// Tightening the number is how this dimension iterates; raising it needs a
// deliberate law amendment.
import fs from 'node:fs';
import path from 'node:path';

const LIMIT = 400;
const over = [];
for (const f of fs.readdirSync('tools').filter((f) => f.endsWith('.mjs'))) {
  const lines = fs.readFileSync(path.join('tools', f), 'utf8').split('\n').length;
  if (lines > LIMIT) over.push(`tools/${f} (${lines} lines)`);
}
if (over.length > 0) {
  console.error(`tools over the ${LIMIT}-line floor: ${over.join(', ')} — split the tool or amend this law deliberately`);
  process.exit(1);
}
