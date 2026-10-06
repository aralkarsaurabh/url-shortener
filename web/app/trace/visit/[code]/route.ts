const SHOWN_HEADERS = ["ratelimit-limit", "ratelimit-remaining", "ratelimit-reset", "retry-after", "x-served-by", "location"];

// Opens a short link the way a browser would, but without following the redirect, so the page
// can show the status, the Location and the rate limit headers.
export async function GET(_request: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const backend = process.env.BACKEND_URL ?? "http://localhost:3302";
  const started = performance.now();
  try {
    const res = await fetch(`${backend}/${encodeURIComponent(code)}`, { redirect: "manual", cache: "no-store" });
    const text = await res.text();
    const headers: Record<string, string> = {};
    for (const name of SHOWN_HEADERS) {
      const value = res.headers.get(name);
      if (value !== null) headers[name] = value;
    }
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }
    return Response.json({
      status: res.status,
      statusText: res.statusText,
      location: res.headers.get("location"),
      headers,
      body,
      durationMs: Math.round(performance.now() - started),
    });
  } catch {
    return Response.json({ error: "Could not reach the URL shortener service." }, { status: 502 });
  }
}
