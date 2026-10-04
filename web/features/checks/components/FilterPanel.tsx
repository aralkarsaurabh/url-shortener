"use client";

import { Panel } from "@/shared/components/Panel";
import { StepLog } from "@/shared/components/StepLog";
import ui from "@/shared/components/ui.module.css";
import { useExperiment } from "@/shared/hooks/useExperiment";
import { randomClientIp } from "@/shared/lib/clientIp";
import { randomCode } from "@/shared/lib/randomCode";
import { useChecker } from "@/features/checker/hooks/useChecker";
import { createLink, getCounters, inspectCode, resetCounters, visit } from "../api/shortenerChecks";

const UNKNOWN_CODES = 30;

export function FilterPanel() {
  const { instance } = useChecker();
  const { steps, running, error, start } = useExperiment();

  const run = () =>
    start(async ({ add }) => {
      const clientIp = randomClientIp();
      const { code: real } = await createLink({ clientIp, instance });
      add({ label: "Created a real link", status: "info", detail: `code ${real}` });
      await resetCounters(instance);

      const fake = Array.from({ length: UNKNOWN_CODES }, randomCode);
      const answers = (await Promise.all(fake.map((code) => visit(code, { clientIp, instance })))).flatMap((r) => r.results);
      add({
        label: `Asked for ${UNKNOWN_CODES} codes that were never created`,
        status: answers.every((r) => r.status === 404) ? "pass" : "fail",
        detail: `answers: ${[...new Set(answers.map((r) => r.status))].join(", ")}`,
      });

      const { counts } = await getCounters(instance);
      const [rejected, reads, cacheTouches] = [
        counts["filter.rejected"] ?? 0,
        counts["db.reads"] ?? 0,
        (counts["cache.miss"] ?? 0) + (counts["cache.hit"] ?? 0) + (counts["cache.not_found"] ?? 0),
      ];
      add({
        label: "The filter turned them away before the cache and the database",
        status: rejected >= UNKNOWN_CODES - 1 && reads === 0 ? "pass" : "fail",
        detail: `turned away by the filter: ${rejected}, cache lookups: ${cacheTouches}, database reads: ${reads} (expected ${UNKNOWN_CODES}, 0 and 0, allowing one rare false alarm)`,
        data: counts,
      });

      const inspected = await inspectCode(fake[0], instance);
      add({
        label: "Nothing was cached for a made-up code",
        status: inspected.filter.mightContain === false && inspected.cache.kind === "not_cached" ? "pass" : "fail",
        detail: `filter says "might exist": ${inspected.filter.mightContain}, cache: ${inspected.cache.kind}`,
      });

      await resetCounters(instance);
      const realVisit = await visit(real, { clientIp, instance });
      const after = await getCounters(instance);
      add({
        label: "A real code gets through the filter",
        status: realVisit.results[0].status === 302 && (after.counts["filter.passed"] ?? 0) === 1 ? "pass" : "fail",
        detail: `answer ${realVisit.results[0].status}, passed the filter: ${after.counts["filter.passed"] ?? 0}`,
      });
    });

  return (
    <Panel
      title="Code filter"
      intro="Before a request reaches the cache or the database, a Bloom filter in Redis checks whether the code was ever created. A code that was never created is answered 404 straight away. The filter can wrongly say a code might exist, but never wrongly say it does not."
      lookFor="All never-created codes are answered 404, the filter turns them all away, and there are no cache lookups and no database reads for them. A real code still redirects."
    >
      <div className={ui.controls}>
        <button type="button" disabled={running} onClick={run}>
          Run
        </button>
      </div>
      {error && <p className={ui.error}>{error}</p>}
      <StepLog steps={steps} />
    </Panel>
  );
}
