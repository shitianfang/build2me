// The parent, built against the child contract's stub: this module's graph
// resolves and loads today, while `greet` has no implementation anywhere.
import { greet, shout } from '../stubs/greet.mjs';

export function banner(name) {
  return `${shout(name)}\n${greet(name)}`;
}
