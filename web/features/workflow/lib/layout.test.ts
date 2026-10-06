import test from "node:test";
import assert from "node:assert/strict";
import { buildLayout, groupStatus } from "./layout.ts";
import type { Atom, FlowSpec } from "../model/types";

const atom = (id: string, group?: string): Atom => ({ id, title: id, icon: "check", group, inLabel: id, status: "idle", summary: id, sections: [] });
const flow: FlowSpec = {
  atoms: [atom("a"), atom("b", "g"), atom("c", "g"), atom("d")],
  groups: [{ id: "g", title: "Group", icon: "db" }],
};

test("a group is one node until it is exploded", () => {
  assert.equal(buildLayout(flow, false).nodes.length, 3);
  const exploded = buildLayout(flow, true);
  assert.equal(exploded.nodes.length, 4);
  assert.equal(exploded.frames.length, 1);
});

test("edges join neighbours and run into the next node", () => {
  const { nodes, edges } = buildLayout(flow, false);
  assert.equal(edges.length, nodes.length - 1);
  assert.ok(edges[0].toX > edges[0].fromX);
});

test("a group is running while only part of it is done", () => {
  assert.equal(groupStatus(["success", "idle"]), "running");
  assert.equal(groupStatus(["success", "skipped"]), "success");
  assert.equal(groupStatus(["skipped", "skipped"]), "skipped");
  assert.equal(groupStatus(["success", "error"]), "error");
  assert.equal(groupStatus(["idle", "idle"]), "idle");
});
