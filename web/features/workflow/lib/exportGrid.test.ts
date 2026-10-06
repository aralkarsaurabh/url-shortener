import test from "node:test";
import assert from "node:assert/strict";
import { planRows, planSpots, wrapChars, wrapSmart, wrapText } from "./exportGrid.ts";

test("short flows stay in one row", () => {
  assert.deepEqual(planRows(1), [1]);
  assert.deepEqual(planRows(3), [3]);
});

test("long flows are split evenly, never leaving one alone", () => {
  assert.deepEqual(planRows(6), [3, 3]);
  assert.deepEqual(planRows(7), [3, 2, 2]);
  assert.deepEqual(planRows(9), [3, 3, 3]);
  assert.deepEqual(planRows(11), [3, 3, 3, 2]);
});

test("rows snake, so each row starts under the column the last one ended in", () => {
  const spots = planSpots([3, 3, 3]);
  assert.deepEqual(spots.map((s) => s.col), [0, 1, 2, 2, 1, 0, 0, 1, 2]);
  const uneven = planSpots([3, 2, 2]);
  assert.deepEqual(uneven.map((s) => s.col), [0, 1, 2, 2, 1, 1, 2]);
  for (let i = 1; i < spots.length; i++) {
    if (spots[i].row !== spots[i - 1].row) assert.equal(spots[i].col, spots[i - 1].col);
  }
});

test("text wraps to the width and is cut with an ellipsis", () => {
  const fits = (line: string) => line.length <= 10;
  assert.deepEqual(wrapText("Short URL Response", fits, 2), ["Short URL", "Response"]);
  assert.deepEqual(wrapText("", fits, 2), []);
  const cut = wrapText("a very long summary that cannot fit at all", fits, 2);
  assert.equal(cut.length, 2);
  assert.ok(cut[1].endsWith("…") && cut[1].length <= 10);
});

test("a long word is broken at any character, and cut with an ellipsis when it is too long", () => {
  const fits = (line: string) => line.length <= 10;
  assert.deepEqual(wrapChars("abcdefghijklmno", fits), ["abcdefghij", "klmno"]);
  assert.deepEqual(wrapSmart("http://localhost:3302/abc", fits, 3), ["http://loc", "alhost:330", "2/abc"]);
  const cut = wrapSmart("http://localhost:3302/abcdefghijklmnop", fits, 2);
  assert.equal(cut.length, 2);
  assert.ok(cut[1].endsWith("…"));
  assert.deepEqual(wrapSmart("Filter knows the code", fits, 2), ["Filter", "knows the…"]);
});
