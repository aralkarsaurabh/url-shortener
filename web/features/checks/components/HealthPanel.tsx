"use client";

import { useState } from "react";
import { parseBody, probeOne } from "@/features/probe/api/probeClient";
import type { ProbeResult } from "@/features/probe/model/types";
import { Panel } from "@/shared/components/Panel";
import { StatusBadge } from "@/shared/components/StatusBadge";
import ui from "@/shared/components/ui.module.css";
import { useChecker } from "@/features/checker/hooks/useChecker";

type Health = { status: string; instance: string; checks: { postgres: string; redis: string } };
type Row = { url: string; result: ProbeResult; health: Health | null };

export function HealthPanel() {
  const { config } = useChecker();
  const [rows, setRows] = useState<Row[]>([]);
  const [running, setRunning] = useState(false);

  async function check() {
    if (!config) return;
    setRunning(true);
    const next = await Promise.all(
      config.shortener.map(async (url, instance): Promise<Row> => {
        const result = await probeOne({ service: "shortener", instance, path: "/health" });
        return { url, result, health: parseBody<Health>(result) };
      }),
    );
    setRows(next);
    setRunning(false);
  }

  return (
    <Panel
      title="Instances and health"
      intro="Every instance reports whether PostgreSQL and Redis answer. Redis being down is reported as degraded but still healthy, because the service keeps working without it. PostgreSQL being down is unavailable (503)."
      lookFor="Each instance has its own name, status ok, and both dependencies ok. Run more than one instance and set SHORTENER_URLS to see them all here."
    >
      <div className={ui.controls}>
        <button type="button" disabled={running || !config} onClick={check}>
          Check all instances
        </button>
        <span className={ui.note}>Checking: {config?.shortener.join(", ") ?? "loading the settings"}</span>
      </div>
      {rows.length > 0 && (
        <div className={ui.tableWrap}>
          <table className={ui.table}>
            <thead>
              <tr>
                <th>Address</th>
                <th>HTTP</th>
                <th>Instance</th>
                <th>Status</th>
                <th>PostgreSQL</th>
                <th>Redis</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.url}>
                  <td className={ui.mono}>{row.url}</td>
                  <td>
                    <StatusBadge status={row.result.status} />
                  </td>
                  <td className={ui.mono}>{row.health?.instance ?? row.result.error ?? ""}</td>
                  <td>{row.health?.status ?? "no answer"}</td>
                  <td>{row.health?.checks.postgres ?? ""}</td>
                  <td>{row.health?.checks.redis ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
