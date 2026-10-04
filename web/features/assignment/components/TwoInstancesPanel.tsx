"use client";

import { useState } from "react";
import { parseBody, probeOne } from "@/features/probe/api/probeClient";
import type { ProbeResult } from "@/features/probe/model/types";
import { Panel } from "@/shared/components/Panel";
import { ResultTable } from "@/shared/components/ResultTable";
import { Timeline } from "@/shared/components/Timeline";
import ui from "@/shared/components/ui.module.css";
import { useChecker } from "@/features/checker/hooks/useChecker";

type Health = { instance: string; store?: { type: string; status: string } };
type Instance = { url: string; health: Health | null; status: number };

const REQUESTS = 12;

export function TwoInstancesPanel() {
  const { config } = useChecker();
  const addresses = config?.["rate-limiter"] ?? [];
  const [instances, setInstances] = useState<Instance[]>([]);
  const [results, setResults] = useState<ProbeResult[]>([]);
  const [running, setRunning] = useState(false);

  async function check() {
    const found = await Promise.all(
      addresses.map(async (url, instance): Promise<Instance> => {
        const result = await probeOne({ service: "rate-limiter", instance, path: "/health" });
        return { url, health: parseBody<Health>(result), status: result.status };
      }),
    );
    setInstances(found);
  }

  async function send() {
    setRunning(true);
    setResults([]);
    const user = `two-${Math.random().toString(36).slice(2, 8)}`;
    const all: ProbeResult[] = [];
    for (let i = 0; i < REQUESTS; i++) {
      // one user, one request at a time, taking the instances in turn
      const result = await probeOne({ service: "rate-limiter", instance: i % addresses.length, path: "/data", headers: { "x-user-id": user } });
      all.push({ ...result, n: i + 1 });
      setResults([...all]);
    }
    await check();
    setRunning(false);
  }

  const allowed = results.filter((r) => r.status === 200).length;
  const finished = results.length === REQUESTS;
  const storeTypes = new Set(instances.map((i) => i.health?.store?.type));
  const store = storeTypes.size === 1 ? [...storeTypes][0] : undefined;

  return (
    <Panel
      title="Two instances"
      intro="With the count kept inside each instance, one user gets the limit on every instance: through two instances that is twice the limit. With the Redis store the count is shared, so the limit holds however many instances there are."
      lookFor="One user sends 12 requests, alternating between the two instances. With the memory store 10 are allowed (5 on each). With the Redis store only 5 are allowed, whichever instance answers."
    >
      {addresses.length < 2 ? (
        <p className={ui.note}>
          This panel needs two instances. Start them (for example PORT=3201 STORE=redis INSTANCE_ID=one npm start, and PORT=3202 ... INSTANCE_ID=two), then give the page both addresses with RATE_LIMITER_URLS=http://localhost:3201,http://localhost:3202.
        </p>
      ) : (
        <div className={ui.controls}>
          <button type="button" onClick={check}>Check the instances</button>
          <button type="button" disabled={running} onClick={send}>Send {REQUESTS} requests as one user, alternating</button>
        </div>
      )}
      {instances.length > 0 && (
        <div className={ui.tableWrap}>
          <table className={ui.table}>
            <thead>
              <tr><th>Address</th><th>Instance</th><th>Store</th><th>Store status</th></tr>
            </thead>
            <tbody>
              {instances.map((i) => (
                <tr key={i.url}>
                  <td className={ui.mono}>{i.url}</td>
                  <td className={ui.mono}>{i.health?.instance ?? (i.status === 0 ? "no answer" : "?")}</td>
                  <td>{i.health?.store?.type ?? "?"}</td>
                  <td>{i.health?.store?.status ?? "?"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {results.length > 0 && <Timeline results={results} />}
      {finished && (
        <p className={ui.note}>
          <strong>{allowed} allowed, {REQUESTS - allowed} blocked.</strong>{" "}
          {allowed > 5
            ? `The limit is 5, so each instance counted on its own${store === "memory" ? " (the memory store)" : ""}.`
            : `The count is shared between the instances${store === "redis" ? " (the Redis store)" : ""}.`}
        </p>
      )}
      {results.length > 0 && <ResultTable results={results} />}
    </Panel>
  );
}
