import type { Atom } from "../model/types";

export const slug = (text: string) =>
  text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "step";

// A starting point for the post. It lists the real steps of this run, and is meant to be edited.
export function buildCaption(workflowName: string, atoms: Atom[]): string {
  const lines = atoms.map((atom, i) => `${i + 1}. ${atom.title}: ${atom.summary}`);
  return [
    `URL shortener: ${workflowName}`,
    "",
    "Here is how one request moves through the service, step by step. This is a real run, not a mock-up.",
    "",
    ...lines,
    "",
    "Built with Node.js, Express, Postgres and Redis.",
    "",
    "#SystemDesign #NodeJS #PostgreSQL #Redis #BackendDevelopment",
    "",
    "In this folder:",
    "- 00-workflow.png: the whole workflow",
    "- 00-workflow-exploded.png: the same, with the grouped steps opened up",
    "- steps/: one picture for each step, with what it did and what it returned",
    "",
  ].join("\n");
}
