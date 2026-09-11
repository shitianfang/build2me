import { add } from './add.mjs';
import { mul } from './mul.mjs';

export function calc(expr) {
  const m = String(expr).match(/^(\d+)\s*([+*])\s*(\d+)$/);
  if (!m) throw new Error(`calc: bad expression: ${expr}`);
  const a = Number(m[1]);
  const b = Number(m[3]);
  return m[2] === '+' ? add(a, b) : mul(a, b);
}
