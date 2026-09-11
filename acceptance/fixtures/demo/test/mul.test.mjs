import test from 'node:test';
import assert from 'node:assert/strict';
import { mul } from '../src/mul.mjs';

test('multiplies', () => {
  assert.equal(mul(3, 4), 12);
  assert.equal(mul(7, 0), 0);
});
