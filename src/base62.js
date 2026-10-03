const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

export const BASE62_PATTERN = /^[0-9A-Za-z]+$/;

export function encodeBase62(num) {
  let n = BigInt(num);
  if (n < 0n) throw new RangeError('Cannot encode a negative number');
  if (n === 0n) return ALPHABET[0];
  let out = '';
  while (n > 0n) {
    out = ALPHABET[Number(n % 62n)] + out;
    n /= 62n;
  }
  return out;
}

export function decodeBase62(str) {
  let n = 0n;
  for (const ch of str) {
    const idx = ALPHABET.indexOf(ch);
    if (idx === -1) throw new RangeError(`Invalid Base62 character: ${ch}`);
    n = n * 62n + BigInt(idx);
  }
  return n;
}
