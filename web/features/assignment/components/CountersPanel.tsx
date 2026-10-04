"use client";

import { useState } from "react";
import { probeOne } from "@/features/probe/api/probeClient";
import type { ProbeResult } from "@/features/probe/model/types";
import { Panel } from "@/shared/components/Panel";
import ui from "@/shared/components/ui.module.css";

type Metrics = {
  instance: string;
  algorithm: string;
  sinceSeconds: number;
  inFlight: number;
  counts: Record<string, number>;
  memory: { heapUsedMB: number; rssMB: number };
};

// 200 and JSON with a counts object means the balancer's own metrics. Anything else (a mock server saying
// "Hello from Server N!") means the balancer forwarded the path, so debug is off.
function readMetrics(result: ProbeResult): Metrics | null {
  if (result.status !== 200) return null;
  try {
    const body = JSON.parse(result.body);
    return body && typeof body === "object" && body.counts && body.memory ? (body as Metrics) : null;
  } catch {
    return null;
  }
}

export function CountersPanel() {
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function refresh() {
    const result = await probeOne({ service: "balancer", path: "/__lb/metrics" });
    if (result.status === 0) {
      setProblem("Start the balancer: cd round-robin-load-balancer && npm run start:all");
      return;
    }
    const read = readMetrics(result);
    if (!read) {
      setProblem("Debug is off. Start the balancer with ENABLE_DEBUG=true.");
      return;
    }
    setProblem(null);
    setMetrics(read);
  }

  async function run(action: () => Promise<void>) {
    setLoading(true);
    await action();
    setLoading(false);
  }

  async function reset() {
    await probeOne({ service: "balancer", method: "POST", path: "/__lb/metrics/reset" });
    await refresh();
  }

  const entries = metrics ? Object.entries(metrics.counts).sort(([a], [b]) => a.localeCompare(b)) : [];

  return (
    <Panel
      title="Counters"
      intro="What the balancer has done since it started (or since you pressed Reset): requests, the answers it passed back by status class, the errors it made itself, retries on another server, and the attempts and failures of each server."
      lookFor="Every request is counted once in requests.total and once as either an answer (answers.2xx and so on) or a balancer error. A retry shows in retries and in the attempts of the second server."
    >
      <div className={ui.controls}>
        <button type="button" disabled={loading} onClick={() => run(refresh)}>Refresh</button>
        <button type="button" disabled={loading} onClick={() => run(reset)}>Reset counters</button>
      </div>
      <p className={ui.note}>Turn on ENABLE_DEBUG=true to see the counters. Use the other sections first, so there is traffic to see.</p>
      {problem && <p className={ui.error}>{problem}</p>}
      {metrics && (
        <>
          <p>
            Method <strong>{metrics.algorithm}</strong>, {metrics.sinceSeconds} s since start or reset, {metrics.inFlight} requests in progress,
            memory: heap {metrics.memory.heapUsedMB} MB, total {metrics.memory.rssMB} MB.
          </p>
          {entries.length === 0 ? (
            <p className={ui.note}>Nothing counted yet.</p>
          ) : (
            <div className={ui.tableWrap}>
              <table className={ui.table}>
                <thead>
                  <tr><th>Counter</th><th>Count</th></tr>
                </thead>
                <tbody>
                  {entries.map(([name, count]) => (
                    <tr key={name}>
                      <td className={ui.mono}>{name}</td>
                      <td>{count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </Panel>
  );
}
