import type { ProbeResponse, ProbeResult } from "../model/types";
import type { NormalizedProbe } from "./validateProbe";

// The headers worth showing. The rest would only be noise.
const SHOWN_HEADERS = [
  "x-served-by",
  "x-backend",
  "x-lb-error",
  "via",
  "location",
  "retry-after",
  "ratelimit-limit",
  "ratelimit-remaining",
  "ratelimit-reset",
  "content-type",
];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function sendOne(probe: NormalizedProbe, n: number): Promise<ProbeResult> {
  const started = performance.now();
  try {
    const response = await fetch(new URL(probe.path, probe.baseUrl), {
      method: probe.method,
      headers: { ...probe.headers, ...(probe.body !== undefined ? { "content-type": "application/json" } : {}) },
      body: probe.body,
      redirect: "manual", // we want to see the redirect, not follow it
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    const text = await response.text();
    const headers: Record<string, string> = {};
    for (const name of SHOWN_HEADERS) {
      const value = response.headers.get(name);
      if (value !== null) headers[name] = value;
    }
    return { n, status: response.status, ms: Math.round(performance.now() - started), headers, body: text.slice(0, 2000) };
  } catch (error) {
    const reason = error instanceof Error ? (error.cause as { code?: string } | undefined)?.code ?? error.message : "failed";
    return { n, status: 0, ms: Math.round(performance.now() - started), headers: {}, body: "", error: reason };
  }
}

// Sends the request `repeat` times, with up to `concurrency` in flight at once.
export async function runProbe(probe: NormalizedProbe): Promise<ProbeResponse> {
  const started = performance.now();
  const results: ProbeResult[] = new Array(probe.repeat);
  let next = 0;

  async function worker() {
    for (;;) {
      const index = next++;
      if (index >= probe.repeat) return;
      results[index] = await sendOne(probe, index + 1);
      if (probe.delayMs > 0 && probe.concurrency === 1 && index + 1 < probe.repeat) await sleep(probe.delayMs);
    }
  }

  await Promise.all(Array.from({ length: Math.min(probe.concurrency, probe.repeat) }, worker));
  return { results, totalMs: Math.round(performance.now() - started) };
}
