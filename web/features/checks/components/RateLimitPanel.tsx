"use client";

import { useState } from "react";
import type { ProbeResult } from "@/features/probe/model/types";
import { probe } from "@/features/probe/api/probeClient";
import { Panel } from "@/shared/components/Panel";
import { ResultTable } from "@/shared/components/ResultTable";
import { Timeline } from "@/shared/components/Timeline";
import ui from "@/shared/components/ui.module.css";
import { randomClientIp } from "@/shared/lib/clientIp";
import { useChecker } from "@/features/checker/hooks/useChecker";
import { createLink } from "../api/shortenerChecks";
import { sampleRows } from "../lib/sampleRows";

type Mode = "create" | "lookup";

export function RateLimitPanel() {
  const { instance } = useChecker();
  const [mode, setMode] = useState<Mode>("create");
  const [count, setCount] = useState(13);
  const [client, setClient] = useState<string | null>(null);
  const [results, setResults] = useState<ProbeResult[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function changeMode(next: Mode) {
    setMode(next);
    setCount(next === "create" ? 13 : 310);
  }

  async function run() {
    setRunning(true);
    setError(null);
    setResults([]);
    try {
      const clientIp = client ?? randomClientIp();
      setClient(clientIp);
      if (mode === "create") {
        const sent = await probe({
          service: "shortener",
          instance,
          method: "POST",
          path: "/shorten",
          headers: { "x-forwarded-for": clientIp },
          body: { url: "https://example.com/rate-limit-check" },
          repeat: count,
        });
        setResults(sent.results);
      } else {
        const { code } = await createLink({ clientIp: randomClientIp(), instance }); // made by a different client
        const sent = await probe({
          service: "shortener",
          instance,
          path: `/${code}`,
          headers: { "x-forwarded-for": clientIp },
          repeat: count,
          concurrency: 20,
        });
        setResults(sent.results);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setRunning(false);
    }
  }

  const limit = Number(results[0]?.headers["ratelimit-limit"]);
  const allowed = results.filter((r) => r.status !== 429).length;
  const blocked = results.filter((r) => r.status === 429);

  return (
    <Panel
      title="Rate limit (the shortener's own)"
      intro="Each client may create 10 links a minute and look up 300 a minute. The count lives in Redis, so every instance shares it. This test acts as one made-up client and sends more than the limit."
      lookFor="The first requests succeed, then every one is answered 429 with a Retry-After header. A new client starts fresh."
    >
      <div className={ui.controls}>
        <label>
          Limit to test
          <select value={mode} onChange={(e) => changeMode(e.target.value as Mode)}>
            <option value="create">Creating links (10 a minute)</option>
            <option value="lookup">Looking up links (300 a minute)</option>
          </select>
        </label>
        <label>
          Requests
          <input type="number" min={1} max={400} value={count} onChange={(e) => setCount(Math.min(400, Math.max(1, Number(e.target.value) || 1)))} />
        </label>
        <button type="button" disabled={running} onClick={run}>
          Send
        </button>
        <button type="button" disabled={running} onClick={() => { setClient(null); setResults([]); }}>
          Use a new client
        </button>
      </div>
      <p className={ui.note}>
        Acting as client {client ?? "(chosen when you press Send)"}. Needs the shortener to run with TRUST_PROXY=1, otherwise every test shares one address.
      </p>
      {error && <p className={ui.error}>{error}</p>}
      {results.length > 0 && (
        <>
          <Timeline results={results} />
          <p className={ui.note}>
            {allowed} allowed, {blocked.length} blocked
            {Number.isFinite(limit) && ` (the limit is ${limit}: ${allowed === limit ? "matches" : "does not match"})`}.
          </p>
          <ResultTable results={sampleRows(results)} />
          <p className={ui.note}>Table: the first request, the first blocked one, and the last.</p>
        </>
      )}
    </Panel>
  );
}
