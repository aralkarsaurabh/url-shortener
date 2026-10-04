"use client";

import { useState } from "react";
import { parseBody, probeOne } from "@/features/probe/api/probeClient";
import type { ProbeResult } from "@/features/probe/model/types";
import { Panel } from "@/shared/components/Panel";
import { Timeline } from "@/shared/components/Timeline";
import ui from "@/shared/components/ui.module.css";

type Health = {
  instance: string;
  algorithm: string;
  uptimeSeconds: number;
  limiters: Record<string, { trackedUsers: number | null; maxTrackedUsers: number | null }>;
};

const MANY = 60;

export function CapacityPanel() {
  const [health, setHealth] = useState<Health | null>(null);
  const [results, setResults] = useState<ProbeResult[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  async function refresh() {
    const result = await probeOne({ service: "rate-limiter", path: "/health" });
    const body = parseBody<Health>(result);
    if (result.status === 0) setProblem("No answer. Start the rate limiter: cd rate-limiter && npm start");
    else if (!body?.limiters) setProblem("This rate limiter does not report capacity yet (it needs slice 4).");
    else {
      setProblem(null);
      setHealth(body);
    }
  }

  async function sendMany() {
    setRunning(true);
    setResults([]);
    const run = Math.random().toString(36).slice(2, 6);
    const all: ProbeResult[] = [];
    for (let start = 0; start < MANY; start += 20) {
      // twenty different users at a time, each asking /data once
      const batch = await Promise.all(
        Array.from({ length: Math.min(20, MANY - start) }, (_, i) =>
          probeOne({ service: "rate-limiter", path: "/data", headers: { "x-user-id": `cap-${run}-${start + i}` } }),
        ),
      );
      all.push(...batch.map((r, i) => ({ ...r, n: start + i + 1 })));
      setResults([...all]);
    }
    await refresh();
    setRunning(false);
  }

  const refused = results.filter((r) => r.status === 503).length;
  const capReached = health ? Object.values(health.limiters).some((l) => l.maxTrackedUsers !== null && l.trackedUsers === l.maxTrackedUsers) : false;

  return (
    <Panel
      title="Capacity"
      intro="The limiter remembers each user it has seen, so its memory could grow without end if someone invents user ids. It remembers at most MAX_TRACKED_USERS users per route. A new user beyond that gets 503, while users it already knows are not affected."
      lookFor="The tracked count goes up with each new user until it reaches the maximum. After that new users get 503 (amber) and the count stays at the maximum. Start the service with MAX_TRACKED_USERS=50 to see it, because the default is 10000."
    >
      <div className={ui.controls}>
        <button type="button" onClick={refresh}>Refresh</button>
        <button type="button" disabled={running} onClick={sendMany}>Send requests from {MANY} different users</button>
      </div>
      {problem && <p className={ui.error}>{problem}</p>}
      {health && (
        <div className={ui.tableWrap}>
          <table className={ui.table}>
            <thead>
              <tr><th>Route</th><th>Users remembered</th><th>Maximum</th></tr>
            </thead>
            <tbody>
              {Object.entries(health.limiters).map(([route, l]) => (
                <tr key={route}>
                  <td className={ui.mono}>/{route}</td>
                  <td>{l.trackedUsers ?? "not tracked"}</td>
                  <td>{l.maxTrackedUsers ?? "no limit"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {health && <p className={ui.note}>Instance {health.instance}, running for {health.uptimeSeconds} s, method {health.algorithm}.</p>}
      {results.length > 0 && <Timeline results={results} />}
      {refused > 0 && <p className={ui.note}>{refused} new users were refused with 503 LIMITER_FULL. The limiter is full for new users until old ones are forgotten.</p>}
      {capReached && refused === 0 && results.length > 0 && <p className={ui.note}>The maximum was reached exactly.</p>}
    </Panel>
  );
}
