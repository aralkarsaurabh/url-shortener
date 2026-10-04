"use client";

import { useState } from "react";
import type { ProbeResult } from "@/features/probe/model/types";
import { Panel } from "@/shared/components/Panel";
import { StepLog } from "@/shared/components/StepLog";
import { Timeline } from "@/shared/components/Timeline";
import ui from "@/shared/components/ui.module.css";
import { useExperiment } from "@/shared/hooks/useExperiment";
import { randomClientIp } from "@/shared/lib/clientIp";
import { sleep } from "@/shared/lib/sleep";
import { useChecker } from "@/features/checker/hooks/useChecker";
import { createLink, inspectCode, visit } from "../api/shortenerChecks";

export function ExpiryPanel() {
  const { instance } = useChecker();
  const { steps, running, error, start } = useExperiment();
  const [seconds, setSeconds] = useState(5);
  const [results, setResults] = useState<ProbeResult[]>([]);

  const run = () =>
    start(async ({ add }) => {
      setResults([]);
      const clientIp = randomClientIp();
      const { code, expiresAt } = await createLink({ expiresInSeconds: seconds, clientIp, instance });
      add({ label: `Created a link that expires in ${seconds} s`, status: "info", detail: `code ${code}, expires at ${expiresAt}` });

      const seen: ProbeResult[] = [];
      for (let second = 0; second <= seconds + 3; second++) {
        const { results: once } = await visit(code, { clientIp, instance });
        seen.push(once[0]);
        setResults([...seen]);
        const cache = await inspectCode(code, instance);
        add({
          label: `After about ${second} s: answer ${once[0].status}${once[0].status === 410 ? " (expired)" : ""}`,
          status: "info",
          detail: `cache: ${cache.cache.kind}${cache.cache.ttlMs !== null ? `, time left in cache ${(cache.cache.ttlMs / 1000).toFixed(1)} s` : ""}`,
        });
        await sleep(1000);
      }

      const firstGone = seen.findIndex((r) => r.status === 410);
      const redirectsBefore = seen.slice(0, Math.max(firstGone, 0)).every((r) => r.status === 302);
      add({
        label: "Redirected while the link was alive, then answered 410 Gone once it expired",
        status: firstGone > 0 && redirectsBefore && seen.slice(firstGone).every((r) => r.status === 410) ? "pass" : "fail",
        detail: firstGone === -1 ? "it never expired" : `first 410 after about ${firstGone} s`,
      });
    });

  return (
    <Panel
      title="Link expiry"
      intro="A link can be given a lifetime. After that it answers 410 Gone. A cached redirect is given a cache time no longer than what is left of the link, so it can never outlive it."
      lookFor="302 on every visit until the time is up, then 410. The time left in the cache counts down and never goes past the expiry."
    >
      <div className={ui.controls}>
        <label>
          Lifetime (seconds)
          <input type="number" min={2} max={30} value={seconds} onChange={(e) => setSeconds(Math.min(30, Math.max(2, Number(e.target.value) || 2)))} />
        </label>
        <button type="button" disabled={running} onClick={run}>
          Run
        </button>
      </div>
      {error && <p className={ui.error}>{error}</p>}
      {results.length > 0 && <Timeline results={results} />}
      <StepLog steps={steps} />
    </Panel>
  );
}
