import { parseBody, probeOne } from "@/features/probe/api/probeClient";
import type { ProbeResult } from "@/features/probe/model/types";
import type { ShortenInput, ShortenedUrl } from "../model/types";

type ApiError = {
  error?: { message?: string; details?: { field: string; message: string }[] };
};

// The service answers errors as { error: { code, message, details? } }.
function errorMessage(body: ApiError | null, status: number): string {
  const details = body?.error?.details?.map((d) => d.message).join(". ");
  return details || body?.error?.message || `Request failed with status ${status}`;
}

export async function shortenUrl(input: ShortenInput): Promise<Omit<ShortenedUrl, "id">> {
  const result = await probeOne({ service: "shortener", method: "POST", path: "/shorten", body: input });
  if (result.status === 0) throw new Error("Could not reach the URL shortener service. Is it running?");

  const body = parseBody<{ code: string; shortUrl: string; expiresAt: string | null } & ApiError>(result);
  if (result.status !== 201 || !body) throw new Error(errorMessage(body, result.status));
  return { code: body.code, shortUrl: body.shortUrl, originalUrl: input.url, expiresAt: body.expiresAt ?? null };
}

// Follows a short link once without leaving the page, so the answer can be shown.
export function testRedirect(code: string): Promise<ProbeResult> {
  return probeOne({ service: "shortener", path: `/${code}` });
}
