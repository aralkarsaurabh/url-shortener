export type NodeStatus = "idle" | "running" | "success" | "error" | "skipped";

export type CanvasView = {
  x: number;
  y: number;
  scale: number;
};

export type Counters = Record<string, number>;

export type RateLimitInfo = {
  limit: number;
  remaining: number;
  resetSeconds: number;
};

// Everything we saw of one real call to the URL shortener.
export type CallTrace = {
  request: { method: string; path: string; body: unknown };
  response: null | {
    status: number;
    statusText: string;
    headers: Record<string, string>;
    body: unknown;
  };
  durationMs: number;
  rateLimit: RateLimitInfo | null;
  retryAfterSeconds: number | null;
  error: string | null;
};

// What GET /debug/code/:code returns (only when the service runs with ENABLE_DEBUG=true).
export type Inspect = {
  code: string;
  filter: { mightContain: boolean };
  cache: { kind: "not_cached" | "not_found" | "gone" | "url"; url: string | null; ttlMs: number | null; leaseHeld: boolean };
  clicks: { savedInDatabase: number | null; waitingInRedis: number | null };
  database: { code: string; originalUrl: string; clickCount: number; expiresAt: string | null } | null;
};

export type Section = {
  title: string;
  text?: string;
  code?: string;
  rows?: [string, string][];
};

export type IconName =
  | "hand" | "shield" | "check" | "dice" | "hash" | "filter" | "db" | "trash" | "reply"
  | "search" | "bolt" | "plus" | "click" | "clock" | "link";

// One real step inside the service. A group is a few atoms shown as one node until you explode it.
export type Atom = {
  id: string;
  title: string;
  icon: IconName;
  group?: string;
  trigger?: boolean;
  inLabel: string; // what travels along the line into this step
  status: NodeStatus; // the final outcome once a run has finished
  summary: string;
  verdict?: { ok: boolean; text: string };
  sections: Section[];
};

export type Group = { id: string; title: string; icon: IconName };

export type FlowSpec = { atoms: Atom[]; groups: Group[] };

export type VisitTrace = {
  status: number;
  statusText: string;
  location: string | null;
  headers: Record<string, string>;
  body: unknown;
  durationMs: number;
  error: string | null;
};
