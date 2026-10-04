"use client";

import { useState } from "react";
import { parseBody, probe, probeOne } from "@/features/probe/api/probeClient";
import { Panel } from "@/shared/components/Panel";
import ui from "@/shared/components/ui.module.css";

type Member = { url: string; weight: number; inFlight: number; state: string };
type Status = { algorithm: string; backends: Member[] };

export function DistributionPanel() {
  const [status, setStatus] = useState<Status | null>(null);
  const [requests, setRequests] = useState(30);
  const [concurrency, setConcurrency] = useState(5);
  const [counts, setCounts] = useState<Record<string, number> | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  async function readStatus(): Promise<Status | null> {
    const result = await probeOne({ service: "balancer", path: "/__lb/status" });
    if (result.status === 0) {
      setProblem("No answer from the balancer. Start everything: cd round-robin-load-balancer && npm run start:all");
      return null;
    }
    if (result.status === 404) {
      setProblem("Debug is off. Start the balancer with ENABLE_DEBUG=true.");
      return null;
    }
    const body = parseBody<Status>(result);
    if (!body?.backends) {
      setProblem("The status page did not answer as expected. Start the balancer with ENABLE_DEBUG=true.");
      return null;
    }
    setProblem(null);
    setStatus(body);
    return body;
  }

  async function send() {
    setRunning(true);
    const current = await readStatus();
    if (current) {
      const response = await probe({ service: "balancer", path: "/", repeat: requests, concurrency });
      const tally: Record<string, number> = {};
      for (const result of response.results) {
        const key = result.headers["x-backend"] ?? "no answer";
        tally[key] = (tally[key] ?? 0) + 1;
      }
      setCounts(tally);
    }
    setRunning(false);
  }

  const totalWeight = status ? status.backends.reduce((sum, b) => sum + b.weight, 0) : 0;
  const biggest = counts ? Math.max(1, ...Object.values(counts)) : 1;

  return (
    <Panel
      title="Distribution"
      intro="Round robin gives every server the same number of requests. That is wrong when one server is bigger (weights fix it) or when one is slow (least connections fixes it, by sending each request to the server with the fewest requests in progress)."
      lookFor="With weights 3,1,1 the first server gets three times the others, as the expected column says. With least connections and one slow mock server, the slow one gets clearly fewer."
    >
      <div className={ui.controls}>
        <label>Requests <input type="number" min={1} max={500} value={requests} onChange={(e) => setRequests(Number(e.target.value))} /></label>
        <label>Concurrency <input type="number" min={1} max={50} value={concurrency} onChange={(e) => setConcurrency(Number(e.target.value))} /></label>
        <button type="button" disabled={running} onClick={send}>Send</button>
        <button type="button" disabled={running} onClick={readStatus}>Refresh</button>
      </div>
      <p className={ui.note}>
        Start the balancer with ALGORITHM=weighted WEIGHTS=3,1,1 (or ALGORITHM=least-connections, with one mock server started with DELAY_MS=200) and ENABLE_DEBUG=true to see the other methods.
      </p>
      {problem && <p className={ui.error}>{problem}</p>}
      {status && (
        <p>
          Method in use: <strong>{status.algorithm}</strong>
          {status.algorithm === "weighted" && <> ({status.backends.map((b) => b.weight).join(", ")})</>}
        </p>
      )}
      {status && counts && (
        <div className={ui.tableWrap}>
          <table className={ui.table}>
            <thead>
              <tr><th>Server</th><th>Answered</th><th></th><th>Expected with these weights</th></tr>
            </thead>
            <tbody>
              {status.backends.map((b) => (
                <tr key={b.url}>
                  <td className={ui.mono}>{b.url}</td>
                  <td>{counts[b.url] ?? 0}</td>
                  <td><div style={{ background: "currentColor", opacity: 0.5, height: 12, width: `${((counts[b.url] ?? 0) / biggest) * 100}%`, minWidth: 2 }} /></td>
                  <td>{status.algorithm === "least-connections" ? "depends on how fast each server is" : Math.round((requests * b.weight) / totalWeight)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
