import type { ShortenInput, ShortenedUrl } from "../model/types";

type ApiError = {
  error?: { message?: string; details?: { field: string; message: string }[] };
};

// The service answers errors as { error: { code, message, details? } }.
function errorMessage(body: ApiError, status: number): string {
  const details = body.error?.details?.map((d) => d.message).join(". ");
  return details || body.error?.message || `Request failed with status ${status}`;
}

export async function shortenUrl(input: ShortenInput): Promise<Omit<ShortenedUrl, "id">> {
  let res: Response;
  try {
    res = await fetch("/api/shorten", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
  } catch {
    throw new Error("Could not reach the URL shortener service. Is it running?");
  }

  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(errorMessage(body, res.status));
  return {
    code: body.code,
    shortUrl: body.shortUrl,
    originalUrl: input.url,
    expiresAt: body.expiresAt ?? null,
  };
}
