import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeBase62, decodeBase62 } from '../src/base62.js';

test('encodes known values', () => {
  assert.equal(encodeBase62(0), '0');
  assert.equal(encodeBase62(61), 'z');
  assert.equal(encodeBase62(62), '10');
});

test('decode reverses encode', () => {
  for (const n of [1, 125, 99999, 2n ** 40n]) {
    assert.equal(decodeBase62(encodeBase62(n)), BigInt(n));
  }
});
