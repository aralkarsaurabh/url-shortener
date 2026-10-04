import type { ProbeResult } from "@/features/probe/model/types";
import { StatusBadge } from "./StatusBadge";
import ui from "./ui.module.css";

const DETAIL_HEADERS = ["location", "retry-after", "ratelimit-remaining", "ratelimit-reset"];

function details(result: ProbeResult): string {
  if (result.error) return `no answer (${result.error})`;
  return DETAIL_HEADERS.filter((name) => result.headers[name] !== undefined)
    .map((name) => `${name}: ${result.headers[name]}`)
    .join("  ");
}

export function ResultTable({ results }: { results: ProbeResult[] }) {
  return (
    <div className={ui.tableWrap}>
      <table className={ui.table}>
        <thead>
          <tr>
            <th>#</th>
            <th>Status</th>
            <th>ms</th>
            <th>Answered by</th>
            <th>Headers</th>
            <th>Body</th>
          </tr>
        </thead>
        <tbody>
          {results.map((r, index) => (
            <tr key={`${r.n}-${index}`}>
              <td>{r.n}</td>
              <td>
                <StatusBadge status={r.status} />
              </td>
              <td>{r.ms}</td>
              <td className={ui.mono}>{r.headers["x-served-by"] ?? r.headers["x-backend"] ?? ""}</td>
              <td className={ui.mono}>{details(r)}</td>
              <td className={ui.mono}>{r.body.slice(0, 120)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
