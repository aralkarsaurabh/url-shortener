import type { ProbeConfig } from "../model/types";

const list = (value: string | undefined, fallback: string) =>
  (value ?? fallback)
    .split(",")
    .map((url) => url.trim())
    .filter(Boolean);

// Where the services are. Server side only, so the browser can only ever reach these addresses.
export function serviceUrls(): ProbeConfig {
  return {
    shortener: list(process.env.SHORTENER_URLS, "http://localhost:3000"),
    "rate-limiter": list(process.env.RATE_LIMITER_URL, "http://localhost:3200"),
    balancer: list(process.env.BALANCER_URL, "http://localhost:3300"),
  };
}
