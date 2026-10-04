import type { ProbeResult } from "@/features/probe/model/types";
import { StatusBadge, statusClass } from "./StatusBadge";
import ui from "./ui.module.css";

export function countByStatus(results: ProbeResult[]): [number, number][] {
  const counts = new Map<number, number>();
  for (const { status } of results) counts.set(status, (counts.get(status) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => a[0] - b[0]);
}

// One coloured square per request, in the order they were sent, with totals per status.
export function Timeline({ results }: { results: ProbeResult[] }) {
  return (
    <div>
      <div className={ui.summary}>
        {countByStatus(results).map(([status, count]) => (
          <span key={status}>
            <StatusBadge status={status} /> × {count}
          </span>
        ))}
      </div>
      <div className={ui.timeline} style={{ marginTop: 8 }}>
        {results.map((r) => (
          <span key={r.n} className={`${ui.tick} ${statusClass(r.status)}`} title={`#${r.n}: ${r.status} in ${r.ms} ms`} />
        ))}
      </div>
    </div>
  );
}
