import test from 'node:test';
import assert from 'node:assert/strict';
import { shortenSchema, CODE_PATTERN, isPossibleCode, MAX_URL_LENGTH, MAX_EXPIRY_SECONDS } from '../src/schemas.js';

const ok = (input) => shortenSchema.safeParse(input).success;

test('accepts http and https urls, and trims spaces', () => {
  assert.ok(ok({ url: 'http://example.com' }));
  assert.ok(ok({ url: 'https://example.com/path?q=1#frag' }));
  const parsed = shortenSchema.parse({ url: '  https://example.com  ' });
  assert.equal(parsed.url, 'https://example.com');
});

test('rejects other schemes, bad urls, credentials and long urls', () => {
  for (const url of [
    'javascript:alert(1)',
    'data:text/html,hi',
    'ftp://example.com',
    'example.com',
    'http://',
    'https://user:pass@example.com',
    '',
    42,
    undefined,
  ]) {
    assert.equal(ok({ url }), false, `should reject ${url}`);
  }
  assert.equal(ok({ url: `https://example.com/${'a'.repeat(MAX_URL_LENGTH)}` }), false);
});

test('alias rules', () => {
  for (const alias of ['abc', 'My-Link_1', 'a'.repeat(32)]) {
    assert.ok(ok({ url: 'https://example.com', alias }), `should accept ${alias}`);
  }
  for (const alias of ['ab', 'a'.repeat(33), 'has space', 'dot.dot', 'slash/x', '', 'stats', 'SHORTEN', 'Api']) {
    assert.equal(ok({ url: 'https://example.com', alias }), false, `should reject ${alias}`);
  }
});

test('expiry rules', () => {
  for (const expiresInSeconds of [1, 3600, MAX_EXPIRY_SECONDS]) {
    assert.ok(ok({ url: 'https://example.com', expiresInSeconds }));
  }
  for (const expiresInSeconds of [0, -5, 1.5, MAX_EXPIRY_SECONDS + 1, '60', null]) {
    assert.equal(ok({ url: 'https://example.com', expiresInSeconds }), false);
  }
});

test('code pattern matches what aliases and generated codes can be', () => {
  assert.ok(CODE_PATTERN.test('aB3_-9'));
  assert.ok(CODE_PATTERN.test('A'.repeat(32)));
  assert.equal(CODE_PATTERN.test('A'.repeat(33)), false);
  assert.equal(CODE_PATTERN.test(''), false);
  assert.equal(CODE_PATTERN.test('a.b'), false);
});

test('isPossibleCode accepts what we can make and rejects the rest', () => {
  for (const code of ['7i1AaCT', 'my-alias', 'abc', '1', 'B', 'a_b-c']) {
    assert.ok(isPossibleCode(code), `should accept ${code}`);
  }
  for (const code of ['', 'a.b', 'has space', 'x'.repeat(33), 'stats', 'Shorten', 'API', 'health', 'ü']) {
    assert.equal(isPossibleCode(code), false, `should reject ${code}`);
  }
});
