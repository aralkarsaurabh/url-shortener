import test from "node:test";
import assert from "node:assert/strict";
import { CODE_MAX, CODE_MIN, decodeBase62, encodeSteps } from "./base62.ts";

test("decodes a code to the number it was made from", () => {
  assert.equal(decodeBase62("10"), 62n);
  assert.equal(decodeBase62("1000000"), CODE_MIN);
  assert.equal(decodeBase62("zzzzzzz"), CODE_MAX - 1n);
});

test("the steps rebuild the code, last remainder first", () => {
  const steps = encodeSteps(decodeBase62("KSuPN9U"));
  assert.equal(steps.map((s) => s.char).reverse().join(""), "KSuPN9U");
  assert.equal(steps.length, 7);
});

test("rejects characters outside the alphabet", () => {
  assert.throws(() => decodeBase62("ab-c"), RangeError);
});
