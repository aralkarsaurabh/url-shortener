"use client";

import { useState } from "react";
import { parseBody, probe } from "@/features/probe/api/probeClient";
import type { ProbeResult } from "@/features/probe/model/types";
import { Panel } from "@/shared/components/Panel";
import { ResultTable } from "@/shared/components/ResultTable";
import { StepLog } from "@/shared/components/StepLog";
import { Timeline } from "@/shared/components/Timeline";
import ui from "@/shared/components/ui.module.css";
import { useExperiment } from "@/shared/hooks/useExperiment";

const MESSAGE = "Too Many Requests: Try again later.";
const data = (user: string, repeat = 1) =>
  probe({ service: "rate-limiter", path: "/data", headers: { "x-user-id": user }, repeat });

export function RateLimiterTaskPanel() {
  const { steps, running, error, start } = useExperiment();
  const [user, setUser] = useState("alice");
  const [results, setResults] = useState<ProbeResult[]>([]);
  const [manualError, setManualError] = useState<string | null>(null);

  const assignmentCheck = () =>
    start(async ({ add }) => {
      const suffix = Math.random().toString(36).slice(2, 7);
      const [alice, bob] = [`alice-${suffix}`, `bob-${suffix}`];

      const five = (await data(alice, 5)).results;
      add({
        label: "Five requests from one user are all allowed",
        status: five.every((r) => r.status === 200) ? "pass" : "fail",
        detail: `answers: ${five.map((r) => r.status).join(", ")}; requests left: ${five.map((r) => parseBody<{ requestsLeft: number }>(r)?.requestsLeft).join(", ")}`,
      });

      const sixth = (await data(alice)).results[0];
      add({
        label: "The sixth request is refused with the required message",
        status: sixth.status === 429 && sixth.body === MESSAGE ? "pass" : "fail",
        detail: `status ${sixth.status}, body "${sixth.body}", Retry-After ${sixth.headers["retry-after"] ?? "none"} s`,
      });

      const other = (await data(bob)).results[0];
      add({
        label: "A different user is not affected",
        status: other.status === 200 ? "pass" : "fail",
        detail: `${bob}: status ${other.status}`,
      });

      add({
        label: "The limit lasts a minute",
        status: "info",
        detail: "Retry-After above says how long this user has to wait. The unit tests prove the window with a fake clock, so no one has to wait a real minute.",
      });
    });

  async function send(repeat: number) {
    setManualError(null);
    try {
      setResults((await data(user, repeat)).results);
    } catch (err) {
      setManualError(err instanceof Error ? err.message : "Failed");
    }
  }

  return (
    <Panel
      title="Task 2: Rate limiter, GET /data"
      intro="Each user may call GET /data 5 times a minute. The sixth call gets 429 and “Too Many Requests: Try again later.” Requests are remembered as timestamps per user in an in-memory dictionary, and anything older than 60 seconds is dropped."
      lookFor="Five answers of 200 (with the requests left going down), then 429 with the exact message. A different user still gets 200."
    >
      <div className={ui.controls}>
        <button type="button" disabled={running} onClick={assignmentCheck}>
          Run the assignment check
        </button>
      </div>
      {error && <p className={ui.error}>{error}</p>}
      <StepLog steps={steps} />

      <h3>Try it by hand</h3>
      <div className={ui.controls}>
        <label>
          User
          <input type="text" value={user} onChange={(e) => setUser(e.target.value.trim())} aria-label="User id" />
        </label>
        <button type="button" disabled={!user} onClick={() => send(1)}>Send 1 request</button>
        <button type="button" disabled={!user} onClick={() => send(7)}>Send 7 quickly</button>
      </div>
      {manualError && <p className={ui.error}>{manualError}</p>}
      {results.length > 0 && (
        <>
          <Timeline results={results} />
          <ResultTable results={results} />
        </>
      )}
    </Panel>
  );
}
