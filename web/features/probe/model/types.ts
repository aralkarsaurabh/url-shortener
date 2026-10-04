export type ProbeService = "shortener" | "rate-limiter" | "balancer";

// What the browser asks the probe route to do.
export type ProbeRequest = {
  service: ProbeService;
  instance?: number; // which of the configured addresses (for the shortener there can be several)
  method?: "GET" | "POST";
  path: string; // must start with "/"
  headers?: Record<string, string>;
  body?: unknown; // sent as JSON on POST
  repeat?: number; // how many times to send it
  concurrency?: number; // how many at the same moment
  delayMs?: number; // pause between requests (only when concurrency is 1)
};

export type ProbeResult = {
  n: number; // 1, 2, 3, ... in the order they were started
  status: number; // 0 means no answer
  ms: number;
  headers: Record<string, string>; // only the headers worth looking at
  body: string;
  error?: string;
};

export type ProbeResponse = { results: ProbeResult[]; totalMs: number };

export type ProbeConfig = Record<ProbeService, string[]>;
