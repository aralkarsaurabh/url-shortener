import type { Atom, Counters, FlowSpec, Inspect, NodeStatus, Section, VisitTrace } from "../model/types";
import { countersDiff } from "./shortenFlow";

export type VisitData = {
  trace: VisitTrace;
  beforeCounters: Counters | null;
  afterCounters: Counters | null;
  before: Inspect | null;
  after: Inspect | null;
};

const NO_DEBUG: Section = {
  title: "Live details",
  text: "Start the URL shortener with ENABLE_DEBUG=true to see what is really stored in Redis and Postgres.",
};

const CODE_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;
const RESERVED = new Set(["shorten", "stats", "health", "api", "debug"]);
export const isPossibleCode = (code: string) => CODE_PATTERN.test(code) && !RESERVED.has(code.toLowerCase());

// Accepts a bare code or a whole short link, and returns the code.
export function codeFromInput(value: string): string {
  const trimmed = value.trim();
  try {
    const url = new URL(trimmed);
    return url.pathname.split("/").filter(Boolean)[0] ?? "";
  } catch {
    return trimmed;
  }
}

function outcome(data: VisitData | null) {
  const t = data?.trace;
  const d = (key: string) => (data?.beforeCounters && data.afterCounters ? (data.afterCounters[key] ?? 0) - (data.beforeCounters[key] ?? 0) : 0);
  const status = t?.status ?? null;
  const net = Boolean(t?.error);
  const blocked = status === 429;
  const redirected = status === 302;
  const gone = status === 410;
  const notFound = status === 404;
  const passedFilter = d("filter.passed") > 0 || redirected || gone;
  const rejectedByFilter = notFound && !passedFilter;
  const hit = d("cache.hit") > 0 || d("cache.gone") > 0 || d("cache.not_found") > 0;
  const miss = d("cache.miss") > 0;
  const dbRead = d("db.reads") > 0;
  return { d, status, net, blocked, redirected, gone, notFound, passedFilter, rejectedByFilter, hit, miss, dbRead };
}

export function buildVisitFlow(code: string, data: VisitData | null): FlowSpec {
  const o = outcome(data);
  const has = data !== null;
  const t = data?.trace;
  const passed = has && !o.net && !o.blocked && !o.rejectedByFilter; // got past the filter
  const found = has && (o.redirected || o.gone);
  const ok = (cond: boolean): NodeStatus => (has && cond ? "success" : "idle");
  const rejected = !isPossibleCode(code);

  const cacheLine = (i: Inspect | null) => (i ? i.cache.kind : "unknown");

  const atoms: Atom[] = [
    {
      id: "trigger",
      title: "Manual Trigger",
      icon: "hand",
      trigger: true,
      inLabel: "",
      status: ok(true),
      summary: code || "Click to add a short link",
      sections: [
        { title: "What it holds", text: "The short code (or the whole short link) to open. Save it and the workflow starts." },
        { title: "Code", code: code || "(none yet)" },
      ],
    },
    {
      id: "rate",
      title: "Rate Limit Check",
      icon: "shield",
      inLabel: "GET /<code>",
      status: !has ? "idle" : o.net || o.blocked ? "error" : "success",
      summary: !t
        ? "Allows 300 lookups a minute"
        : t.error
          ? "Service unreachable"
          : o.blocked
            ? `Blocked, retry in ${t.headers["retry-after"] ?? "?"}s`
            : t.headers["ratelimit-remaining"]
              ? `${t.headers["ratelimit-remaining"]} of ${t.headers["ratelimit-limit"]} left`
              : "Allowed",
      verdict: !t
        ? undefined
        : t.error
          ? { ok: false, text: "The request never got an answer." }
          : o.blocked
            ? { ok: false, text: "Blocked: too many lookups." }
            : { ok: true, text: "Allowed." },
      sections: [
        {
          title: "What it does",
          text: "Lookups have their own, larger limit: 300 a minute for each client, kept in Redis the same way as the create limit.",
        },
        ...(t && !t.error ? [{ title: "Answer headers", rows: Object.entries(t.headers) as [string, string][] }] : []),
        ...(t?.error ? [{ title: "Error", text: t.error }] : []),
      ],
    },
    {
      id: "filter",
      title: "Check the Code Filter",
      icon: "filter",
      inLabel: "code",
      status: !has || o.net || o.blocked ? "idle" : o.rejectedByFilter ? "error" : "success",
      summary: !has ? "Could this code exist?" : o.rejectedByFilter ? "Never created" : "Might exist",
      verdict: !has || o.net || o.blocked
        ? undefined
        : o.rejectedByFilter
          ? { ok: false, text: rejected ? "Rejected: not even a possible code." : "Stopped here: this code was never created, so Redis and Postgres were not touched." }
          : { ok: true, text: "The code might exist, so the request goes on." },
      sections: [
        {
          title: "What it does",
          text: "Two free checks that need no Redis and no database. First the shape: 1 to 32 letters, numbers, - and _, and not a reserved word. Then the code filter (a Bloom filter): it can say 'definitely never created' or 'might exist'. Unknown codes are turned away here, so guessing links costs the database nothing.",
        },
        { title: "Shape check on this code", rows: [["letters, numbers, - and _, 1 to 32 characters", rejected ? "FAIL" : "pass"]] },
        ...(has && !o.net && !o.blocked ? [{ title: "Service counters", rows: countersDiff(data.beforeCounters, data.afterCounters, ["filter.passed", "filter.rejected"]) }] : []),
      ],
    },
    {
      id: "cache",
      title: "Ask Redis",
      icon: "bolt",
      group: "find",
      inLabel: "might exist",
      status: ok(passed),
      summary: !has ? "Is the URL cached?" : o.hit ? "Hit: answered from the cache" : o.miss ? "Miss: not cached" : "Looked in Redis",
      sections: [
        {
          title: "What it does",
          text: "One atomic Lua step in Redis: return the cached URL, or else take a short lease on this code. A hit means no database work at all. A miss means this request now holds the lease and must fill the cache. A request that finds someone else holding the lease waits a moment and looks again, so a popular new link causes one database read, not hundreds.",
        },
        ...(data?.before && data.after
          ? [
              {
                title: "Redis, before and after this request",
                rows: [
                  ["before", cacheLine(data.before)],
                  ["after", cacheLine(data.after)],
                ] as [string, string][],
              },
              { title: "Service counters", rows: countersDiff(data.beforeCounters, data.afterCounters, ["cache.hit", "cache.miss", "cache.busy"]) },
            ]
          : [NO_DEBUG]),
      ],
    },
    {
      id: "db",
      title: "Read Postgres",
      icon: "db",
      group: "find",
      inLabel: "cache miss",
      status: !has ? "idle" : !passed ? "idle" : o.dbRead || (o.miss && found) ? "success" : "skipped",
      summary: !has ? "Only on a cache miss" : o.dbRead ? "Read the row" : "Skipped: cache had it",
      sections: [
        { title: "The query", code: "SELECT original_url, expires_at\nFROM urls\nWHERE code = $1" },
        { title: "When it runs", text: "Only when Redis had nothing (a miss). It also checks expires_at: an expired link answers 410 instead of redirecting." },
        ...(data ? [{ title: "Service counters", rows: countersDiff(data.beforeCounters, data.afterCounters, ["db.reads"]) }] : []),
      ],
    },
    {
      id: "fill",
      title: "Fill the Cache",
      icon: "plus",
      group: "find",
      inLabel: "the URL",
      status: !has ? "idle" : !passed ? "idle" : o.miss && found ? "success" : "skipped",
      summary: !has ? "Remember it for next time" : o.miss ? "Saved in Redis" : "Skipped: already cached",
      sections: [
        {
          title: "What it does",
          text: "Saves the URL under url:<code>, but only if this request still holds the lease. The entry lives for an hour (or until the link expires, whichever is sooner), so the next visit is a hit.",
        },
        ...(data?.after ? [{ title: "Redis now holds", rows: [["for this code", cacheLine(data.after)]] as [string, string][] }] : []),
      ],
    },
    {
      id: "queue",
      title: "Count the Click in Redis",
      icon: "click",
      group: "count",
      inLabel: "found",
      status: !has ? "idle" : o.redirected ? "success" : o.gone ? "skipped" : "idle",
      summary: !has ? "Counts one visit" : o.redirected ? "Click queued" : "No click counted",
      sections: [
        {
          title: "What it does",
          text: "Adds one to a counter in Redis, which is fast. If Redis is down the click is written straight to Postgres so it is not lost.",
        },
        ...(data?.before && data.after
          ? [
              {
                title: "Clicks waiting in Redis",
                rows: [
                  ["before", String(data.before.clicks.waitingInRedis ?? "?")],
                  ["after", String(data.after.clicks.waitingInRedis ?? "?")],
                ] as [string, string][],
              },
              { title: "Service counters", rows: countersDiff(data.beforeCounters, data.afterCounters, ["clicks.queued", "clicks.written_directly"]) },
            ]
          : [NO_DEBUG]),
      ],
    },
    {
      id: "flush",
      title: "Save Clicks in Batches",
      icon: "clock",
      group: "count",
      inLabel: "later",
      status: !has ? "idle" : o.redirected ? "skipped" : "idle",
      summary: "Runs in the background",
      sections: [
        {
          title: "What it does",
          text: "Every 5 seconds (or after 1000 clicks) the waiting counts are moved to Postgres in one transaction. Each batch has an id, so a batch sent again after a crash is never counted twice.",
        },
        ...(data?.after
          ? [
              {
                title: "Click count right now",
                rows: [
                  ["saved in Postgres", String(data.after.clicks.savedInDatabase ?? "?")],
                  ["still waiting in Redis", String(data.after.clicks.waitingInRedis ?? "?")],
                ] as [string, string][],
              },
            ]
          : []),
      ],
    },
    {
      id: "redirect",
      title: "Redirect",
      icon: "link",
      inLabel: "the URL",
      status: !has ? "idle" : o.redirected ? "success" : o.gone || (o.notFound && !o.rejectedByFilter) ? "error" : "idle",
      summary: !has ? "302 to the long URL" : o.redirected ? "302 Found" : o.gone ? "410: link expired" : o.notFound && !o.rejectedByFilter ? "404: not found" : "302 to the long URL",
      verdict: !has
        ? undefined
        : o.redirected
          ? { ok: true, text: "The browser is sent to the original URL." }
          : o.gone
            ? { ok: false, text: "This short URL has expired." }
            : o.notFound && !o.rejectedByFilter
              ? { ok: false, text: "The code passed the filter but is not in the database." }
              : undefined,
      sections: [
        { title: "What it does", text: "Answers 302 with a Location header. The browser follows it to the original URL." },
        ...(t && !t.error
          ? [
              { title: `Answer (${t.status}, ${t.durationMs} ms)`, rows: Object.entries(t.headers) as [string, string][] },
              ...(t.body ? [{ title: "Body", code: JSON.stringify(t.body, null, 2) }] : []),
            ]
          : []),
      ],
    },
  ];

  return {
    atoms,
    groups: [
      { id: "find", title: "Find the URL", icon: "bolt" },
      { id: "count", title: "Count the click", icon: "click" },
    ],
  };
}
