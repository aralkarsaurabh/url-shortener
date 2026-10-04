"use client";

import { useState } from "react";
import { Panel } from "@/shared/components/Panel";
import { JsonBlock, StepLog } from "@/shared/components/StepLog";
import ui from "@/shared/components/ui.module.css";
import { useExperiment } from "@/shared/hooks/useExperiment";
import { randomClientIp } from "@/shared/lib/clientIp";
import { useChecker } from "@/features/checker/hooks/useChecker";
import { createLink, evictCode, getCounters, inspectCode, resetCounters, visit } from "../api/shortenerChecks";

const allRedirects = (results: { status: number }[]) => results.every((r) => r.status === 302);

export function CachePanel() {
  const { instance } = useChecker();
  const { steps, running, error, start } = useExperiment();
  const [code, setCode] = useState("");
  const [manual, setManual] = useState<unknown>(null);
  const [manualError, setManualError] = useState<string | null>(null);

  const cacheVsDatabase = () =>
    start(async ({ add }) => {
      const clientIp = randomClientIp();
      const { code: made } = await createLink({ clientIp, instance });
      add({ label: "Created a test link", status: "info", detail: `code ${made}` });
      await evictCode(made, instance);
      add({ label: "Cleared its cached value, so the first visit has to go to the database", status: "info" });
      await resetCounters(instance);
      add({ label: "Reset the counters", status: "info" });

      const visits = await visit(made, { repeat: 5, clientIp, instance });
      add({
        label: "Visited it 5 times, one after the other",
        status: allRedirects(visits.results) ? "pass" : "fail",
        detail: `answers: ${visits.results.map((r) => r.status).join(", ")}`,
      });

      const { counts } = await getCounters(instance);
      const [misses, hits, reads] = [counts["cache.miss"] ?? 0, counts["cache.hit"] ?? 0, counts["db.reads"] ?? 0];
      add({
        label: "Only the first visit reached the database",
        status: misses === 1 && hits === 4 && reads === 1 ? "pass" : "fail",
        detail: `cache misses ${misses}, cache hits ${hits}, database reads ${reads} (expected 1, 4 and 1)`,
        data: counts,
      });

      const inspected = await inspectCode(made, instance);
      add({
        label: "The cache now holds the link",
        status: inspected.cache.kind === "url" ? "pass" : "fail",
        detail: `value: ${inspected.cache.kind}, time left: ${Math.round((inspected.cache.ttlMs ?? 0) / 1000)} s`,
        data: inspected.cache,
      });
    });

  const stampede = () =>
    start(async ({ add }) => {
      const clientIp = randomClientIp();
      const { code: made } = await createLink({ clientIp, instance });
      add({ label: "Created a test link", status: "info", detail: `code ${made}` });
      await evictCode(made, instance);
      await resetCounters(instance);
      add({ label: "Cleared its cached value and reset the counters", status: "info" });

      const burst = await visit(made, { repeat: 50, concurrency: 50, clientIp, instance });
      add({
        label: "Sent 50 visits at the same moment",
        status: allRedirects(burst.results) ? "pass" : "fail",
        detail: `all answers: ${[...new Set(burst.results.map((r) => r.status))].join(", ")}, in ${burst.totalMs} ms`,
      });

      const { counts } = await getCounters(instance);
      const reads = counts["db.reads"] ?? 0;
      add({
        label: "Only one of the 50 requests read the database (the lease)",
        status: reads === 1 ? "pass" : "fail",
        detail: `database reads: ${reads} (expected 1). The other requests waited for the cache to be filled: ${counts["cache.busy"] ?? 0} waits, then ${counts["cache.hit"] ?? 0} cache hits.`,
        data: counts,
      });
    });

  async function runManual(action: "inspect" | "visit" | "evict") {
    setManualError(null);
    try {
      if (action === "inspect") setManual(await inspectCode(code, instance));
      if (action === "evict") {
        await evictCode(code, instance);
        setManual({ evicted: code });
      }
      if (action === "visit") setManual((await visit(code, { instance, clientIp: randomClientIp() })).results[0]);
    } catch (err) {
      setManualError(err instanceof Error ? err.message : "Failed");
    }
  }

  return (
    <Panel
      title="Cache and leases"
      intro="Redirects are served from Redis. When a link is not cached, one request gets a lease and fills the cache while the others wait, so a popular link that just expired cannot flood the database."
      lookFor="After the first visit, cache hits go up and database reads stay at 1. In the stampede test, 50 requests at once still read the database once."
    >
      <div className={ui.controls}>
        <button type="button" disabled={running} onClick={cacheVsDatabase}>
          Run: cache vs database
        </button>
        <button type="button" disabled={running} onClick={stampede}>
          Run: 50 requests at once (lease)
        </button>
      </div>
      {error && <p className={ui.error}>{error}</p>}
      <StepLog steps={steps} />

      <h3>Try it by hand</h3>
      <div className={ui.controls}>
        <input type="text" value={code} onChange={(e) => setCode(e.target.value.trim())} placeholder="a short code" aria-label="Short code" />
        <button type="button" disabled={!code} onClick={() => runManual("inspect")}>Inspect</button>
        <button type="button" disabled={!code} onClick={() => runManual("visit")}>Visit</button>
        <button type="button" disabled={!code} onClick={() => runManual("evict")}>Clear from cache</button>
      </div>
      {manualError && <p className={ui.error}>{manualError}</p>}
      {manual !== null && <JsonBlock value={manual} />}
    </Panel>
  );
}
