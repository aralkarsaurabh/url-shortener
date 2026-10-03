import { randomInt } from 'node:crypto';
import { encodeBase62 } from './base62.js';

// A random number from 62^6 up to 62^7 always encodes to exactly 7 Base62 characters.
// That is about 3.4 trillion codes, and they cannot be guessed in order.
export function randomCode() {
  return encodeBase62(randomInt(62 ** 6, 62 ** 7));
}
