"use client";

import { useState } from "react";
import { buildCaption, slug } from "../lib/caption";
import { renderDetailPng } from "../lib/exportDetailPng";
import { downloadBlob, renderFlowPng } from "../lib/exportPng";
import { buildLayout } from "../lib/layout";
import { createZip, type ZipFile } from "../lib/zip";
import type { FlowSpec } from "../model/types";

const FOOTER = "System design assignment · Node.js, Express, Postgres, Redis";
const pad = (n: number) => String(n).padStart(2, "0");
const breathe = () => new Promise((resolve) => setTimeout(resolve, 0)); // lets the page stay responsive

type Options = {
  tabKey: string; // "shorten" or "visit", used in file names
  workflowName: string;
  flow: FlowSpec;
  done: boolean; // has the workflow been run
};

// The three ways out: the whole workflow as one picture, one step as a picture, and a ZIP of everything.
export function useExports({ tabKey, workflowName, flow, done }: Options) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const total = flow.atoms.length;

  // Counts the steps as they appear in the picture, not the parts hidden inside a group.
  function subtitleFor(exploded: boolean): string {
    if (!done) return "The workflow, step by step";
    const nodes = buildLayout(flow, exploded).nodes;
    const ran = nodes.filter((n) => n.status === "success").length;
    const skipped = nodes.filter((n) => n.status === "skipped").length;
    return `A real run: ${ran} steps${skipped ? `, ${skipped} skipped` : ""}${exploded ? ", exploded view" : ""}`;
  }

  const flowOptions = (exploded: boolean) => ({
    title: `URL shortener: ${workflowName}`,
    subtitle: subtitleFor(exploded),
    footer: FOOTER,
  });

  const flowPng = (exploded: boolean) => renderFlowPng(buildLayout(flow, exploded), flowOptions(exploded));

  function detailPng(atomIds: string[]) {
    const atoms = flow.atoms.filter((a) => atomIds.includes(a.id));
    const first = flow.atoms.findIndex((a) => a.id === atoms[0]?.id) + 1;
    const last = first + atoms.length - 1;
    const stepLabel = atoms.length > 1 ? `Steps ${first} to ${last} of ${total}` : `Step ${first} of ${total}`;
    return { atoms, first, png: renderDetailPng({ workflow: workflowName, stepLabel, atoms, footer: FOOTER }) };
  }

  async function run(job: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await job();
    } catch (err) {
      setError(err instanceof Error ? err.message : "The export failed.");
    } finally {
      setBusy(false);
    }
  }

  const exportFlow = (exploded: boolean) =>
    run(async () => downloadBlob(await flowPng(exploded), `url-shortener-${tabKey}${exploded ? "-exploded" : ""}.png`));

  const exportAtoms = (atomIds: string[]) =>
    run(async () => {
      const { atoms, first, png } = detailPng(atomIds);
      downloadBlob(await png, `url-shortener-${tabKey}-step-${pad(first)}-${slug(atoms[0]?.title ?? "step")}.png`);
    });

  const exportZip = () =>
    run(async () => {
      const dir = `url-shortener-${tabKey}`;
      const files: ZipFile[] = [];
      const add = async (name: string, blob: Blob) => files.push({ name: `${dir}/${name}`, data: new Uint8Array(await blob.arrayBuffer()) });

      await add("00-workflow.png", await flowPng(false));
      await breathe();
      await add("00-workflow-exploded.png", await flowPng(true));
      for (const atom of flow.atoms) {
        await breathe();
        const { first, png } = detailPng([atom.id]);
        await add(`steps/${pad(first)}-${slug(atom.title)}.png`, await png);
      }
      files.push({ name: `${dir}/caption.txt`, data: new TextEncoder().encode(buildCaption(workflowName, flow.atoms)) });

      downloadBlob(new Blob([createZip(files) as BlobPart], { type: "application/zip" }), `${dir}.zip`);
    });

  return { busy, error, exportFlow, exportAtoms, exportZip };
}
