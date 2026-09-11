import test from 'node:test';
import assert from 'node:assert/strict';
import { calc } from '../src/calc.mjs';

test('integrates add and mul', () => {
  assert.equal(calc('2+3'), 5);
  assert.equal(calc('2*3'), 6);
});
