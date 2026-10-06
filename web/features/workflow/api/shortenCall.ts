import type { CallTrace } from "../model/types";

const SHOWN_HEADERS = ["ratelimit-limit", "ratelimit-remaining", "ratelimit-reset", "retry-after", "x-served-by", "content-type"];

function numberHeader(headers: Headers, name: string): number | null {
  const raw = headers.get(name);
  if (raw === null) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

// Sends the real request. The browser calls /api/shorten and Next.js forwards it to the service.
export async function callShorten(url: string): Promise<CallTrace> {
  const request = { method: "POST", path: "/shorten", body: { url } };
  const started = performance.now();
  try {
    const res = await fetch("/api/shorten", {
      method: request.method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request.body),
    });
    const body = await res.json().catch(() => null);
    const durationMs = Math.round(performance.now() - started);

    const headers: Record<string, string> = {};
    for (const name of SHOWN_HEADERS) {
      const value = res.headers.get(name);
      if (value !== null) headers[name] = value;
    }

    const limit = numberHeader(res.headers, "ratelimit-limit");
    const remaining = numberHeader(res.headers, "ratelimit-remaining");
    const resetSeconds = numberHeader(res.headers, "ratelimit-reset");
    const rateLimit =
      limit !== null && remaining !== null && resetSeconds !== null ? { limit, remaining, resetSeconds } : null;

    return {
      request,
      response: { status: res.status, statusText: res.statusText, headers, body },
      durationMs,
      rateLimit,
      retryAfterSeconds: numberHeader(res.headers, "retry-after"),
      error: null,
    };
  } catch {
    return {
      request,
      response: null,
      durationMs: Math.round(performance.now() - started),
      rateLimit: null,
      retryAfterSeconds: null,
      error: "Could not reach the URL shortener service. Is it running on port 3302?",
    };
  }
}
