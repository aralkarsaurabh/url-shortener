import test from "node:test";
import assert from "node:assert/strict";
import { sampleRows } from "./sampleRows.ts";

const rows = (...statuses: number[]) => statuses.map((status, i) => ({ n: i + 1, status }));
const numbers = (list: { n: number }[]) => list.map((r) => r.n);

test("shows the first, the first blocked and the last", () => {
  assert.deepEqual(numbers(sampleRows(rows(201, 201, 201, 429, 429, 429))), [1, 4, 6]);
});

test("each row appears once when they overlap", () => {
  assert.deepEqual(numbers(sampleRows(rows(201, 201, 429))), [1, 3]); // first blocked is also the last
  assert.deepEqual(numbers(sampleRows(rows(429, 429))), [1, 2]); // the first is the first blocked
  assert.deepEqual(numbers(sampleRows(rows(429))), [1]); // all three are the same row
});

test("with nothing blocked it shows the first five", () => {
  assert.deepEqual(numbers(sampleRows(rows(200, 200, 200, 200, 200, 200, 200))), [1, 2, 3, 4, 5]);
});

test("an empty burst has no rows", () => {
  assert.deepEqual(sampleRows([]), []);
});
