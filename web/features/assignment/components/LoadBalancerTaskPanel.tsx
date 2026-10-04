"use client";

import { useState } from "react";
import { probe } from "@/features/probe/api/probeClient";
import type { ProbeResult } from "@/features/probe/model/types";
import { Panel } from "@/shared/components/Panel";
import { ResultTable } from "@/shared/components/ResultTable";
import ui from "@/shared/components/ui.module.css";

const serverOf = (result: ProbeResult) => /Server (\d+)/.exec(result.body)?.[1] ?? null;

// Each answer should be the next server after the one before it, wrapping from the last back to the first.
function takesTurns(servers: (string | null)[], total: number): boolean {
  return servers.every((s, i) => s !== null && (i === 0 || Number(s) === (Number(servers[i - 1]) % total) + 1));
}

export function LoadBalancerTaskPanel() {
  const [results, setResults] = useState<ProbeResult[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(repeat: number) {
    setRunning(true);
    setError(null);
    try {
      setResults((await probe({ service: "balancer", path: "/", repeat })).results);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setRunning(false);
    }
  }

  // Tell the person what to do when the balancer or the servers are not there.
  const problem = results.some((r) => r.status === 0)
    ? "No answer from the balancer. Start everything: cd round-robin-load-balancer && npm run start:all"
    : results.some((r) => r.headers["x-lb-error"] === "BAD_GATEWAY")
      ? "The balancer is running but no server answered (502 BAD_GATEWAY). Start the three mock servers: npm run start:all"
      : null;

  const servers = results.map(serverOf);
  const perServer = new Map<string, number>();
  for (const s of servers) if (s) perServer.set(s, (perServer.get(s) ?? 0) + 1);
  const total = Math.max(3, ...[...perServer.keys()].map(Number));

  return (
    <Panel
      title="Task 3: Round robin load balancer"
      intro="Three mock servers answer “Hello from Server N!”. The balancer sends each request to the next server in order, and after Server 3 goes back to Server 1. It forwards requests with the HTTP client built into Node."
      lookFor="The answers go 1, 2, 3, 1, 2, 3 and so on, and each server gets the same number. The Answered by column shows which server the balancer used."
    >
      <div className={ui.controls}>
        <button type="button" disabled={running} onClick={() => send(9)}>
          Send 9 requests
        </button>
        <button type="button" disabled={running} onClick={() => send(1)}>
          Send 1 request
        </button>
      </div>
      <p className={ui.note}>Start everything with: cd round-robin-load-balancer && npm run start:all</p>
      {error && <p className={ui.error}>{error}</p>}
      {problem && <p className={ui.error}>{problem}</p>}
      {results.length > 0 && (
        <>
          <p>
            <strong>Order:</strong> {servers.map((s) => (s ? `Server ${s}` : "no answer")).join(" → ")}
          </p>
          <p>
            <strong>Per server:</strong>{" "}
            {[...perServer.entries()].sort().map(([s, n]) => `Server ${s}: ${n}`).join(", ") || "none"}
          </p>
          {results.length > 1 && (
            <p className={ui.note}>
              {takesTurns(servers, total) ? "✓ Every request went to the next server in turn." : "✗ The order is not a clean rotation (a server may be down)."}
            </p>
          )}
          <ResultTable results={results} />
        </>
      )}
    </Panel>
  );
}
