import ui from "./ui.module.css";

export function statusClass(status: number): string {
  if (status >= 200 && status < 300) return ui.s2xx;
  if (status >= 300 && status < 400) return ui.s3xx;
  if (status === 404) return ui.s404;
  if (status === 410) return ui.s410;
  if (status === 429) return ui.s429;
  return ui.sbad;
}

export function StatusBadge({ status }: { status: number }) {
  return <span className={`${ui.badge} ${statusClass(status)}`}>{status === 0 ? "none" : status}</span>;
}
