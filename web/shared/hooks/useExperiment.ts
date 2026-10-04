"use client";

import { useCallback, useState } from "react";

export type StepStatus = "running" | "pass" | "fail" | "info";
export type Step = { label: string; status: StepStatus; detail?: string; data?: unknown };

export type StepApi = {
  add: (step: Step) => number;
  update: (index: number, patch: Partial<Step>) => void;
};

// Runs an experiment made of steps, and keeps the list of steps for the page to show as it goes.
export function useExperiment() {
  const [steps, setSteps] = useState<Step[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = useCallback(async (body: (api: StepApi) => Promise<void>) => {
    const local: Step[] = [];
    const api: StepApi = {
      add(step) {
        local.push(step);
        setSteps([...local]);
        return local.length - 1;
      },
      update(index, patch) {
        local[index] = { ...local[index], ...patch };
        setSteps([...local]);
      },
    };
    setSteps([]);
    setError(null);
    setRunning(true);
    try {
      await body(api);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The experiment failed");
    } finally {
      setRunning(false);
    }
  }, []);

  return { steps, running, error, start };
}
