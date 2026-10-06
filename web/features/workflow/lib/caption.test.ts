import test from "node:test";
import assert from "node:assert/strict";
import { buildCaption, slug } from "./caption.ts";
import type { Atom } from "../model/types";

const atom = (title: string, summary: string): Atom => ({ id: title, title, icon: "check", inLabel: "", status: "success", summary, sections: [] });

test("slug makes safe file names", () => {
  assert.equal(slug("Turn It into Base62"), "turn-it-into-base62");
  assert.equal(slug("  Ask Redis!  "), "ask-redis");
  assert.equal(slug("???"), "step");
});

test("the caption lists every step in order", () => {
  const text = buildCaption("Shorten a URL", [atom("Manual Trigger", "https://example.com"), atom("Rate Limit Check", "9 of 10 left")]);
  assert.match(text, /1\. Manual Trigger: https:\/\/example.com/);
  assert.match(text, /2\. Rate Limit Check: 9 of 10 left/);
});
