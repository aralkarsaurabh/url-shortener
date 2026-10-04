// Checks what the browser sent to the probe route. The route is a proxy, so it only ever talks to
// the addresses in the config, only with a path that stays on that server, and only with a few
// harmless headers. No imports here, so it can be tested on its own.

type Service = "shortener" | "rate-limiter" | "balancer";
type Config = Record<Service, string[]>;

export type NormalizedProbe = {
  baseUrl: string;
  method: "GET" | "POST";
  path: string;
  headers: Record<string, string>;
  body?: string;
  repeat: number;
  concurrency: number;
  delayMs: number;
};

export type Validation = { ok: true; value: NormalizedProbe } | { ok: false; error: string };

export const LIMITS = { repeat: 400, concurrency: 50, delayMs: 2000, bodyBytes: 10_000 };
const ALLOWED_HEADERS = new Set(["x-user-id", "x-forwarded-for", "content-type", "accept"]);
const SAFE_PATH = /^\/(?!\/)[A-Za-z0-9_\-.~%/?=&:,+@]*$/;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function wholeNumber(value: unknown, fallback: number, min: number, max: number, name: string): number | string {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    return `${name} must be a whole number from ${min} to ${max}`;
  }
  return value;
}

export function validateProbe(input: unknown, config: Config): Validation {
  if (!isObject(input)) return { ok: false, error: "The request must be a JSON object" };

  const service = input.service;
  if (typeof service !== "string" || !Object.hasOwn(config, service)) {
    return { ok: false, error: `service must be one of: ${Object.keys(config).join(", ")}` };
  }
  const addresses = config[service as Service];

  const instance = wholeNumber(input.instance, 0, 0, addresses.length - 1, "instance");
  if (typeof instance === "string") return { ok: false, error: instance };

  const method = input.method ?? "GET";
  if (method !== "GET" && method !== "POST") return { ok: false, error: "method must be GET or POST" };

  const path = input.path;
  if (typeof path !== "string" || !SAFE_PATH.test(path) || path.includes("..")) {
    return { ok: false, error: "path must start with a single / and use only plain URL characters" };
  }

  const headers: Record<string, string> = {};
  if (input.headers !== undefined) {
    if (!isObject(input.headers)) return { ok: false, error: "headers must be an object" };
    for (const [name, value] of Object.entries(input.headers)) {
      const lower = name.toLowerCase();
      if (!ALLOWED_HEADERS.has(lower)) return { ok: false, error: `header ${name} is not allowed` };
      if (typeof value !== "string" || value.length > 200 || /[\r\n]/.test(value)) {
        return { ok: false, error: `header ${name} has an invalid value` };
      }
      headers[lower] = value;
    }
  }

  let body: string | undefined;
  if (method === "POST" && input.body !== undefined) {
    body = typeof input.body === "string" ? input.body : JSON.stringify(input.body);
    if (body.length > LIMITS.bodyBytes) return { ok: false, error: "body is too large" };
  }

  const repeat = wholeNumber(input.repeat, 1, 1, LIMITS.repeat, "repeat");
  if (typeof repeat === "string") return { ok: false, error: repeat };
  const concurrency = wholeNumber(input.concurrency, 1, 1, LIMITS.concurrency, "concurrency");
  if (typeof concurrency === "string") return { ok: false, error: concurrency };
  const delayMs = wholeNumber(input.delayMs, 0, 0, LIMITS.delayMs, "delayMs");
  if (typeof delayMs === "string") return { ok: false, error: delayMs };

  return {
    ok: true,
    value: { baseUrl: addresses[instance], method, path, headers, body, repeat, concurrency, delayMs },
  };
}
