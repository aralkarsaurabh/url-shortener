import type { ShortenedUrl } from "../model/types";

export async function shortenUrl(url: string): Promise<ShortenedUrl> {
  let res: Response;
  try {
    res = await fetch("/api/shorten", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url }),
    });
  } catch {
    throw new Error("Could not reach the URL shortener service. Is it running?");
  }

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.error ?? `Request failed with status ${res.status}`);
  }
  return { code: body.code, shortUrl: body.shortUrl, originalUrl: url, createdAt: Date.now() };
}
