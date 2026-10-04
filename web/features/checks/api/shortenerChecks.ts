import { parseBody, probe, probeOne } from "@/features/probe/api/probeClient";
import type { ProbeResponse, ProbeResult } from "@/features/probe/model/types";

export type CodeInspection = {
  code: string;
  instance: string;
  filter: { mightContain: boolean };
  cache: { kind: "not_cached" | "url" | "not_found" | "gone"; url: string | null; ttlMs: number | null; leaseHeld: boolean };
  clicks: { savedInDatabase: number | null; waitingInRedis: number };
  database: { code: string; originalUrl: string; clickCount: number; expiresAt: string | null } | null;
};

export type Counters = { instance: string; sinceSeconds: number; counts: Record<string, number> };

// Thrown when something the experiment depends on did not work. The message says what to do.
export class CheckError extends Error {}

const forwardedFor = (clientIp?: string) => (clientIp ? { "x-forwarded-for": clientIp } : undefined);

function describe(result: ProbeResult): string {
  if (result.status === 0) return `no answer (${result.error ?? "unknown"}). Is the shortener running?`;
  if (result.status === 429) {
    return "rate limited (429). Run the shortener with TRUST_PROXY=1 so every experiment acts as its own client.";
  }
  return `status ${result.status}: ${result.body.slice(0, 200)}`;
}

export async function createLink(options: {
  alias?: string;
  expiresInSeconds?: number;
  clientIp?: string;
  instance?: number;
}) {
  const result = await probeOne({
    service: "shortener",
    instance: options.instance,
    method: "POST",
    path: "/shorten",
    headers: forwardedFor(options.clientIp),
    body: { url: `https://example.com/check-${Date.now()}`, alias: options.alias, expiresInSeconds: options.expiresInSeconds },
  });
  const body = parseBody<{ code: string; expiresAt: string | null }>(result);
  if (result.status !== 201 || !body) throw new CheckError(`Creating a link failed: ${describe(result)}`);
  return { code: body.code, expiresAt: body.expiresAt, result };
}

export function visit(
  code: string,
  options: { repeat?: number; concurrency?: number; delayMs?: number; clientIp?: string; instance?: number } = {},
): Promise<ProbeResponse> {
  return probe({
    service: "shortener",
    instance: options.instance,
    path: `/${code}`,
    headers: forwardedFor(options.clientIp),
    repeat: options.repeat,
    concurrency: options.concurrency,
    delayMs: options.delayMs,
  });
}

const DEBUG_OFF = "The debug tools are off. Start the shortener with ENABLE_DEBUG=true.";

export async function inspectCode(code: string, instance?: number): Promise<CodeInspection> {
  const result = await probeOne({ service: "shortener", instance, path: `/debug/code/${code}` });
  if (result.status === 404) throw new CheckError(DEBUG_OFF);
  const body = parseBody<CodeInspection>(result);
  if (result.status !== 200 || !body) throw new CheckError(`Inspecting failed: ${describe(result)}`);
  return body;
}

export async function evictCode(code: string, instance?: number) {
  const result = await probeOne({ service: "shortener", instance, method: "POST", path: `/debug/code/${code}/evict` });
  if (result.status === 404) throw new CheckError(DEBUG_OFF);
}

export async function getCounters(instance?: number): Promise<Counters> {
  const result = await probeOne({ service: "shortener", instance, path: "/debug/counters" });
  if (result.status === 404) throw new CheckError(DEBUG_OFF);
  const body = parseBody<Counters>(result);
  if (!body) throw new CheckError(`Reading the counters failed: ${describe(result)}`);
  return body;
}

export async function resetCounters(instance?: number) {
  const result = await probeOne({ service: "shortener", instance, method: "POST", path: "/debug/counters/reset" });
  if (result.status === 404) throw new CheckError(DEBUG_OFF);
}
