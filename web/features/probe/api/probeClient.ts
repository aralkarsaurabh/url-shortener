import type { ProbeConfig, ProbeRequest, ProbeResponse, ProbeResult } from "../model/types";

async function failureMessage(res: Response): Promise<string> {
  const body = await res.json().catch(() => ({}));
  return typeof body.error === "string" ? body.error : `The probe failed with status ${res.status}`;
}

// Runs a request (or many) through the server side probe, so the page sees the real status and headers.
export async function probe(request: ProbeRequest): Promise<ProbeResponse> {
  const res = await fetch("/api/probe", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request),
  });
  if (!res.ok) throw new Error(await failureMessage(res));
  return res.json();
}

export async function probeOne(request: ProbeRequest): Promise<ProbeResult> {
  return (await probe({ ...request, repeat: 1 })).results[0];
}

export async function loadConfig(): Promise<ProbeConfig> {
  const res = await fetch("/api/probe");
  if (!res.ok) throw new Error(await failureMessage(res));
  return (await res.json()).services;
}

export function parseBody<T>(result: ProbeResult): T | null {
  try {
    return JSON.parse(result.body) as T;
  } catch {
    return null;
  }
}
