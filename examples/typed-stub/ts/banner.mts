// The same parent in TypeScript. `npx tsc -p examples/typed-stub` type-checks
// these call sites against ../stubs/greet.d.mts, generated from the very
// contract `banner` is decomposed into — no implementation involved.
import { greet, shout } from '../stubs/greet.mjs';

export function banner(name: string): string {
  return `${shout(name)}\n${greet(name)}`;
}
