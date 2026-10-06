// The same alphabet and maths as url-shortener/src/base62.js, used here to take a real code apart.
const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

export function decodeBase62(code: string): bigint {
  let n = 0n;
  for (const ch of code) {
    const index = ALPHABET.indexOf(ch);
    if (index === -1) throw new RangeError(`Invalid Base62 character: ${ch}`);
    n = n * 62n + BigInt(index);
  }
  return n;
}

export type EncodeStep = { number: bigint; remainder: number; char: string };

// Divide by 62 until nothing is left. Each remainder is one character, last one first.
export function encodeSteps(num: bigint): EncodeStep[] {
  const steps: EncodeStep[] = [];
  let n = num;
  while (n > 0n) {
    const remainder = Number(n % 62n);
    steps.push({ number: n, remainder, char: ALPHABET[remainder] });
    n /= 62n;
  }
  return steps;
}

export const CODE_MIN = 62n ** 6n;
export const CODE_MAX = 62n ** 7n;
export const formatBig = (n: bigint) => n.toLocaleString("en-US");
