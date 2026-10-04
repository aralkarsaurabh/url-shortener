"use client";

import { useState } from "react";
import { parseBody, probeOne } from "@/features/probe/api/probeClient";
import { Panel } from "@/shared/components/Panel";
import { StatusBadge } from "@/shared/components/StatusBadge";
import ui from "@/shared/components/ui.module.css";

type Member = { url: string; state: string; consecutiveFailures: number; retryInMs: number | null; requests: number; failures: number };

export function HealthPanel() {
  const [members, setMembers] = useState<Member[] | null>(null);
  const [counts, setCounts] = useState<Record<string, number> | null>(null);
  const [last, setLast] = useState<{ status: number; error?: string; retryAfter?: string } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  async function refresh() {
    const result = await probeOne({ service: "balancer", path: "/__lb/status" });
    const body = parseBody<{ backends?: Member[] }>(result);
    if (result.status === 0) setProblem("No answer from the balancer. Start everything: cd round-robin-load-balancer && npm run start:all");
    else if (!body?.backends) setProblem("The balancer has no status page. Start it with ENABLE_DEBUG=true.");
    else {
      setProblem(null);
      setMembers(body.backends);
    }
  }

  async function send(count: number) {
    setRunning(true);
    const tally: Record<string, number> = {};
    let latest = null;
    for (let i = 0; i < count; i++) {
      const result = await probeOne({ service: "balancer", path: "/" });
      const key = result.headers["x-backend"] ?? `no server (${result.status})`;
      tally[key] = (tally[key] ?? 0) + 1;
      latest = { status: result.status, error: result.headers["x-lb-error"], retryAfter: result.headers["retry-after"] };
    }
    setCounts(tally);
    setLast(latest);
    await refresh();
    setRunning(false);
  }

  return (
    <Panel
      title="Failure handling"
      intro="A server that fails 3 times in a row is taken out of the rotation for 10 seconds, so the others share its traffic evenly. After that one request is sent to find out whether it is back. If every server is down the balancer says so with 503 and when to try again."
      lookFor="Stop one mock server and send 12 requests: the other two get 6 each and the stopped one gets none. Start it again and wait 10 seconds: it comes back and the split is 4, 4, 4."
    >
      <div className={ui.controls}>
        <button type="button" disabled={running} onClick={() => send(12)}>Send 12 requests</button>
        <button type="button" disabled={running} onClick={refresh}>Show server states</button>
      </div>
      <p className={ui.note}>Needs ENABLE_DEBUG=true on the balancer for the states. Stop and start a mock server in its terminal to see the changes.</p>
      {problem && <p className={ui.error}>{problem}</p>}
      {counts && (
        <p>
          Answered by:{" "}
          {Object.entries(counts).map(([name, n]) => (
            <span key={name}><code>{name}</code> × {n}{"  "}</span>
          ))}
        </p>
      )}
      {last && last.status >= 500 && (
        <p>
          Last answer: <StatusBadge status={last.status} /> <code>{last.error}</code>
          {last.retryAfter && <> Retry-After: {last.retryAfter} s</>}
        </p>
      )}
      {members && (
        <div className={ui.tableWrap}>
          <table className={ui.table}>
            <thead>
              <tr><th>Server</th><th>State</th><th>Failures in a row</th><th>Next trial in</th><th>Requests</th><th>Failures</th></tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.url}>
                  <td className={ui.mono}>{m.url}</td>
                  <td>{m.state}</td>
                  <td>{m.consecutiveFailures}</td>
                  <td>{m.retryInMs === null ? "-" : `${Math.ceil(m.retryInMs / 1000)} s`}</td>
                  <td>{m.requests}</td>
                  <td>{m.failures}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
