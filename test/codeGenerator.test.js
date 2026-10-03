import test from 'node:test';
import assert from 'node:assert/strict';
import { randomCode } from '../src/codeGenerator.js';

test('codes are 7 Base62 characters', () => {
  for (let i = 0; i < 1000; i++) assert.match(randomCode(), /^[0-9A-Za-z]{7}$/);
});

test('codes do not repeat or come in order', () => {
  const codes = Array.from({ length: 5000 }, randomCode);
  assert.equal(new Set(codes).size, codes.length);
  const sorted = [...codes].sort();
  assert.notDeepEqual(codes, sorted);
});
