import type { Counters, Inspect } from "../model/types";

// The debug tools only exist when the service runs with ENABLE_DEBUG=true. Without them the
// page still works, it just has less to show, so every failure here becomes null.
export async function getCounters(): Promise<Counters | null> {
  try {
    const res = await fetch("/api/debug/counters", { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()).counts as Counters;
  } catch {
    return null;
  }
}

export async function inspectCode(code: string): Promise<Inspect | null> {
  try {
    const res = await fetch(`/api/debug/code/${encodeURIComponent(code)}`, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as Inspect;
  } catch {
    return null;
  }
}
