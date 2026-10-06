import type { VisitTrace } from "../model/types";

// A browser hides a redirect's address, so a small route on this app makes the request and tells us.
export async function callVisit(code: string): Promise<VisitTrace> {
  const started = performance.now();
  try {
    const res = await fetch(`/trace/visit/${encodeURIComponent(code)}`, { cache: "no-store" });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    return { ...data, error: null };
  } catch {
    return {
      status: 0,
      statusText: "",
      location: null,
      headers: {},
      body: null,
      durationMs: Math.round(performance.now() - started),
      error: "Could not reach the URL shortener service. Is it running on port 3302?",
    };
  }
}
