"use client";

import { useRef, useState } from "react";
import type { FlowSpec } from "../model/types";

// The real call is fast, so the packet is kept on screen long enough to watch it travel.
const FIRST_STEP_MS = 1400;
const STEP_MS = 650;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type Phase = "idle" | "running" | "done";

type Options<D> = {
  build: (input: string, data: D | null) => FlowSpec;
  call: (input: string) => Promise<D>;
};

// Runs one workflow: sends the one real request, then lights up the steps one after the other,
// using what the real request found out. A step that fails stops the run there.
export function useFlowRun<D>({ build, call }: Options<D>) {
  const [input, setInput] = useState("");
  const [data, setData] = useState<D | null>(null);
  const [reveal, setReveal] = useState(0);
  const [phase, setPhase] = useState<Phase>("idle");
  const runId = useRef(0);

  const final = build(input, data);
  const atoms = final.atoms.map((atom, i) => {
    let status = atom.status;
    if (phase === "idle") status = "idle";
    else if (i < reveal) status = i === 0 ? "success" : data ? atom.status : "success";
    else if (i === reveal && phase === "running") status = "running";
    else status = "idle";
    return { ...atom, status };
  });
  const flow: FlowSpec = { atoms, groups: final.groups };

  async function run(value: string): Promise<FlowSpec | null> {
    const id = ++runId.current;
    setInput(value);
    setData(null);
    setPhase("running");
    setReveal(1);

    const [result] = await Promise.all([call(value), sleep(FIRST_STEP_MS)]);
    if (id !== runId.current) return null;
    setData(result);

    const finished = build(value, result);
    for (let i = 1; i < finished.atoms.length; i++) {
      setReveal(i);
      if (i > 1 && finished.atoms[i].status !== "skipped") await sleep(STEP_MS);
      if (id !== runId.current) return null;
      setReveal(i + 1);
      if (finished.atoms[i].status === "error") break;
    }
    setPhase("done");
    return finished;
  }

  function reset() {
    runId.current += 1;
    setData(null);
    setReveal(0);
    setPhase("idle");
  }

  return { input, data, flow, phase, running: phase === "running", run, reset, setInput };
}
