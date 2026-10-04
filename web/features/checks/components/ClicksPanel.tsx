"use client";

import { useState } from "react";
import { Panel } from "@/shared/components/Panel";
import { StepLog } from "@/shared/components/StepLog";
import ui from "@/shared/components/ui.module.css";
import { useExperiment } from "@/shared/hooks/useExperiment";
import { randomClientIp } from "@/shared/lib/clientIp";
import { sleep } from "@/shared/lib/sleep";
import { useChecker } from "@/features/checker/hooks/useChecker";
import { createLink, getCounters, inspectCode, resetCounters, visit } from "../api/shortenerChecks";

export function ClicksPanel() {
  const { instance } = useChecker();
  const { steps, running, error, start } = useExperiment();
  const [clicks, setClicks] = useState(30);

  const run = () =>
    start(async ({ add, update }) => {
      const clientIp = randomClientIp();
      const { code } = await createLink({ clientIp, instance });
      add({ label: "Created a test link", status: "info", detail: `code ${code}` });
      await resetCounters(instance);

      const sent = await visit(code, { repeat: clicks, concurrency: 10, clientIp, instance });
      add({
        label: `Sent ${clicks} visits`,
        status: sent.results.every((r) => r.status === 302) ? "pass" : "fail",
        detail: `done in ${sent.totalMs} ms`,
      });

      const right = await inspectCode(code, instance);
      add({
        label: "Right after the visits, the clicks are waiting in Redis, not yet in the database",
        status: right.clicks.waitingInRedis > 0 ? "pass" : "info",
        detail: `waiting in Redis: ${right.clicks.waitingInRedis}, saved in the database: ${right.clicks.savedInDatabase}`,
      });

      const watching = add({ label: "Watching the batch being saved", status: "running" });
      let saved = right.clicks.savedInDatabase ?? 0;
      for (let second = 1; second <= 20 && saved < clicks; second++) {
        await sleep(1000);
        const now = await inspectCode(code, instance);
        saved = now.clicks.savedInDatabase ?? 0;
        update(watching, {
          detail: `after ${second} s: waiting in Redis ${now.clicks.waitingInRedis}, saved in the database ${saved}`,
        });
      }
      update(watching, { status: saved === clicks ? "pass" : "fail", label: `All ${clicks} clicks end up in the database, once each` });

      const { counts } = await getCounters(instance);
      add({
        label: "The database was written in batches, not once per click",
        status: (counts["clicks.batches_saved"] ?? 0) < clicks ? "pass" : "fail",
        detail: `${counts["clicks.queued"] ?? 0} clicks queued, saved in ${counts["clicks.batches_saved"] ?? 0} batch(es)`,
        data: counts,
      });
    });

  return (
    <Panel
      title="Click counting and batching"
      intro="Counting every click with its own database write is slow. Clicks are added up in Redis and saved to PostgreSQL in batches every few seconds, or after 1000 clicks."
      lookFor="Right after the visits the clicks are waiting in Redis and the database count is behind. A few seconds later the database catches up to exactly the number sent, saved in one or two batches."
    >
      <div className={ui.controls}>
        <label>
          Clicks to send
          <input type="number" min={1} max={400} value={clicks} onChange={(e) => setClicks(Math.min(400, Math.max(1, Number(e.target.value) || 1)))} />
        </label>
        <button type="button" disabled={running} onClick={run}>
          Run
        </button>
      </div>
      {error && <p className={ui.error}>{error}</p>}
      <StepLog steps={steps} />
    </Panel>
  );
}
