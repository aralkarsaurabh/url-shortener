"use client";

import { useState } from "react";
import { parseBody, probeOne } from "@/features/probe/api/probeClient";
import { Panel } from "@/shared/components/Panel";
import ui from "@/shared/components/ui.module.css";

type Metrics = {
  instance: string;
  algorithm: string;
  store: string;
  sinceSeconds: number;
  counts: Record<string, number>;
  memory: { heapUsedMB: number; rssMB: number };
};

export function CountersPanel() {
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  async function refresh() {
    const result = await probeOne({ service: "rate-limiter", path: "/metrics" });
    if (result.status === 0) return setProblem("No answer. Start the rate limiter: cd rate-limiter && npm start");
    if (result.status === 404) return setProblem("Debug is off. Start the service with ENABLE_DEBUG=true to see the counters.");
    const body = parseBody<Metrics>(result);
    if (!body?.counts) return setProblem(`Unexpected answer (${result.status}).`);
    setProblem(null);
    setMetrics(body);
  }

  async function reset() {
    await probeOne({ service: "rate-limiter", method: "POST", path: "/metrics/reset" });
    await refresh();
  }

  const rows = metrics ? Object.entries(metrics.counts).sort(([a], [b]) => a.localeCompare(b)) : [];
  return (
    <Panel
      title="Counters"
      intro="The service counts every answer it gives from a limited route: allowed, blocked (429), full (503), refused user ids, and store failures. Use the other sections to make traffic, then look here. The numbers are for this instance since it started or since the last reset."
      lookFor="The counts match what you sent. For example, 7 calls to /data as one user show allowed 5 and blocked 2 for /data."
    >
      <div className={ui.controls}>
        <button type="button" onClick={refresh}>Refresh</button>
        <button type="button" onClick={reset}>Reset counters</button>
      </div>
      {problem && <p className={ui.error}>{problem}</p>}
      {metrics && (
        <>
          <p className={ui.note}>
            Instance {metrics.instance}, {metrics.algorithm}, {metrics.store} store, {metrics.sinceSeconds} s since start or reset. Memory: heap {metrics.memory.heapUsedMB} MB, rss {metrics.memory.rssMB} MB.
          </p>
          {rows.length === 0 ? (
            <p className={ui.note}>Nothing counted yet.</p>
          ) : (
            <div className={ui.tableWrap}>
              <table className={ui.table}>
                <thead>
                  <tr><th>Counter</th><th>Count</th></tr>
                </thead>
                <tbody>
                  {rows.map(([name, count]) => (
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
