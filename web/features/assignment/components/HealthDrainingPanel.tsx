"use client";

import { useState } from "react";
import { parseBody, probeOne } from "@/features/probe/api/probeClient";
import { Panel } from "@/shared/components/Panel";
import ui from "@/shared/components/ui.module.css";

type Member = {
  url: string;
  state: "up" | "down" | "trial" | "draining";
  health?: { lastCheck: string | null; lastCheckAgoMs: number | null; failedInARow: number; reason: string | null };
};

const LOOK: Record<Member["state"], { color: string; text: string }> = {
  up: { color: "#1a7f37", text: "up" },
  trial: { color: "#1a7f37", text: "trial (one request is finding out)" },
  draining: { color: "#b8860b", text: "draining: finishing its requests" },
  down: { color: "#cf222e", text: "down" },
};

export function HealthDrainingPanel() {
  const [members, setMembers] = useState<Member[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function refresh() {
    setLoading(true);
    const result = await probeOne({ service: "balancer", path: "/__lb/status" });
    const body = parseBody<{ backends?: Member[] }>(result);
    if (result.status === 0) setProblem("No answer from the balancer. Start everything: cd round-robin-load-balancer && npm run start:all");
    else if (result.status === 404) setProblem("Debug is off. Start the balancer with ENABLE_DEBUG=true.");
    else if (!body?.backends) setProblem("The status page did not answer as expected. Start the balancer with ENABLE_DEBUG=true.");
    else {
      setProblem(null);
      setMembers(body.backends);
    }
    setLoading(false);
  }

  return (
    <Panel
      title="Health and draining"
      intro="Besides watching real requests, the balancer asks every server GET /health every few seconds. A server that fails two checks in a row leaves the rotation, and comes back after two good ones. A server that answers 503 with shutting_down is draining: it gets nothing new, and the requests already running on it finish."
      lookFor="Stop a mock server started with DRAIN_MS=1500 (kill it with Ctrl+C or SIGTERM) while requests are being sent: it turns amber (draining), then red (down) once it has exited, and no request fails. Start it again and it turns green after two good checks."
    >
      <div className={ui.controls}>
        <button type="button" disabled={loading} onClick={refresh}>Refresh</button>
      </div>
      <p className={ui.note}>
        Needs the balancer started with ENABLE_DEBUG=true and servers that have /health. The URL shortener answers shutting_down only briefly when stopped (its listening port closes at once), so you will usually see it go straight to down. The rate limiter has no shutting down state at all.
      </p>
      {problem && <p className={ui.error}>{problem}</p>}
      {members && (
        <div className={ui.tableWrap}>
          <table className={ui.table}>
            <thead>
              <tr><th>Server</th><th>State</th><th>Last check</th><th>Failed in a row</th><th>Why</th></tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.url}>
                  <td className={ui.mono}>{m.url}</td>
                  <td style={{ color: LOOK[m.state].color, fontWeight: 600 }}>{LOOK[m.state].text}</td>
                  <td>
                    {m.health?.lastCheck
                      ? `${m.health.lastCheck}, ${Math.round((m.health.lastCheckAgoMs ?? 0) / 100) / 10} s ago`
                      : "no check yet"}
                  </td>
                  <td>{m.health?.failedInARow ?? 0}</td>
                  <td className={ui.mono}>{m.health?.reason ?? "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
