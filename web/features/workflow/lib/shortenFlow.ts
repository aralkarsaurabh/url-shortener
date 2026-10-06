import type { Atom, CallTrace, Counters, FlowSpec, Inspect, NodeStatus, Section } from "../model/types";
import { CODE_MAX, CODE_MIN, decodeBase62, encodeSteps, formatBig } from "./base62";

export type ShortenData = {
  trace: CallTrace;
  before: Counters | null;
  after: Counters | null;
  inspect: Inspect | null;
};

type Body = { code?: string; shortUrl?: string; expiresAt?: string | null };

export const bodyOf = (trace: CallTrace) => (trace.response?.body ?? {}) as Body;

export function countersDiff(before: Counters | null, after: Counters | null, keys: string[]): [string, string][] {
  if (!before || !after) return [];
  return keys.map((key): [string, string] => [key, `+${(after[key] ?? 0) - (before[key] ?? 0)}`]);
}

const NO_DEBUG: Section = {
  title: "Live details",
  text: "Start the URL shortener with ENABLE_DEBUG=true to see what is really stored in Redis and Postgres.",
};

function urlChecks(url: string): [string, string][] {
  let scheme = false;
  let credentials = false;
  try {
    const parsed = new URL(url);
    scheme = parsed.protocol === "http:" || parsed.protocol === "https:";
    credentials = Boolean(parsed.username || parsed.password);
  } catch {
    // not a URL at all, so every check below stays false
  }
  return [
    ["is a URL starting with http or https", scheme ? "pass" : "FAIL"],
    ["has no username or password in it", scheme && !credentials ? "pass" : "FAIL"],
    [`is at most 2048 characters (this one: ${url.length})`, url.length <= 2048 ? "pass" : "FAIL"],
  ];
}

// The outcome of one real call, as the status of every step it passed through.
function outcome(data: ShortenData | null) {
  const status = data?.trace.response?.status ?? null;
  const code = status === 201 && data ? (bodyOf(data.trace).code ?? null) : null;
  const net = Boolean(data?.trace.error);
  const blocked = status === 429;
  const invalid = status === 400;
  const saved = status === 201;
  const failedSave = data !== null && !net && !blocked && !invalid && !saved;
  return { status, code, net, blocked, invalid, saved, failedSave };
}

export function buildShortenFlow(url: string, data: ShortenData | null): FlowSpec {
  const o = outcome(data);
  const has = data !== null;
  const reached = o.saved || o.failedSave; // got as far as making a code
  const st = (ok: boolean): NodeStatus => (has && ok ? "success" : "idle");
  const trace = data?.trace;
  const inspect = data?.inspect ?? null;

  let numberSection: Section[] = [];
  let encodeSection: Section[] = [];
  if (o.code) {
    const n = decodeBase62(o.code);
    const steps = encodeSteps(n);
    numberSection = [
      {
        title: "This run",
        rows: [
          ["number picked", formatBig(n)],
          ["position in the range", `${(Number(((n - CODE_MIN) * 10000n) / (CODE_MAX - CODE_MIN)) / 100).toFixed(2)}%`],
        ],
      },
    ];
    encodeSection = [
      {
        title: "This run, step by step",
        code: steps
          .map((s) => `${formatBig(s.number).padStart(18)}  ÷ 62  remainder ${String(s.remainder).padStart(2)}  →  ${s.char}`)
          .join("\n"),
      },
      { title: "Read the characters bottom to top", code: o.code },
    ];
  }

  const atoms: Atom[] = [
    {
      id: "trigger",
      title: "Manual Trigger",
      icon: "hand",
      trigger: true,
      inLabel: "",
      status: st(true),
      summary: url || "Click to add a URL",
      sections: [
        { title: "What it holds", text: "The long URL you want to shorten. Save it and the workflow starts." },
        { title: "URL", code: url || "(none yet)" },
      ],
    },
    {
      id: "rate",
      title: "Rate Limit Check",
      icon: "shield",
      group: undefined,
      inLabel: "POST /shorten",
      status: !has ? "idle" : o.net || o.blocked ? "error" : "success",
      summary: !trace
        ? "Checks the request is not one of too many"
        : trace.error
          ? "Service unreachable"
          : o.blocked
            ? `Blocked, retry in ${trace.retryAfterSeconds ?? "?"}s`
            : trace.rateLimit
              ? `${trace.rateLimit.remaining} of ${trace.rateLimit.limit} left`
              : "Allowed",
      verdict: !trace
        ? undefined
        : trace.error
          ? { ok: false, text: "The request never got an answer." }
          : o.blocked
            ? { ok: false, text: `Blocked: too many requests. Try again in ${trace.retryAfterSeconds ?? trace.rateLimit?.resetSeconds ?? "a few"}s.` }
            : trace.rateLimit
              ? { ok: true, text: `Allowed: ${trace.rateLimit.remaining} of ${trace.rateLimit.limit} requests left this minute.` }
              : { ok: true, text: "Allowed. No rate limit headers came back, so the limiter was skipped (Redis may be down)." },
      sections: [
        {
          title: "What it does",
          text: "Runs before anything else, even before the body is read, so a flood costs as little as possible. A sliding window kept in Redis allows 10 creates a minute for each client. Redis supplies the clock, so every app instance agrees. If Redis is down the request is let through.",
        },
        ...(trace?.response
          ? [
              { title: "Answer headers", rows: Object.entries(trace.response.headers) as [string, string][] },
              ...(data?.before && data.after
                ? [{ title: "Service counters", rows: countersDiff(data.before, data.after, ["ratelimit.create.allowed", "ratelimit.create.blocked"]) }]
                : []),
            ]
          : []),
        ...(trace?.error ? [{ title: "Error", text: trace.error }] : []),
      ],
    },
    {
      id: "validate",
      title: "Validate Request",
      icon: "check",
      inLabel: "JSON body",
      status: !has || o.net || o.blocked ? "idle" : o.invalid ? "error" : "success",
      summary: o.invalid ? "Rejected (400)" : has && !o.net && !o.blocked ? "Valid" : "Checks the URL",
      verdict: o.invalid
        ? { ok: false, text: "Rejected: the request is not valid." }
        : has && !o.net && !o.blocked
          ? { ok: true, text: "The request is valid." }
          : undefined,
      sections: [
        {
          title: "What it does",
          text: "Reads the JSON body (at most 10 kb) and checks it with a Zod schema. Anything else is answered with 400 and a list of what is wrong.",
        },
        { title: "Checks on the URL", rows: urlChecks(url) },
        ...(o.invalid && trace ? [{ title: "What the service said", code: JSON.stringify(trace.response?.body, null, 2) }] : []),
      ],
    },
    {
      id: "random",
      title: "Pick a Random Number",
      icon: "dice",
      group: "code",
      inLabel: "valid URL",
      status: st(reached),
      summary: o.code ? formatBig(decodeBase62(o.code)) : "A random number",
      sections: [
        {
          title: "How the code is decided",
          text: "The service picks a random whole number from 62^6 up to 62^7 using the crypto random generator (randomInt from node:crypto). Because it is random, codes cannot be guessed in order. Because of the range, the code always has exactly 7 characters.",
        },
        {
          title: "The range",
          rows: [
            ["lowest (62^6)", formatBig(CODE_MIN)],
            ["highest (62^7)", formatBig(CODE_MAX - 1n)],
            ["possible codes", `about ${formatBig(CODE_MAX - CODE_MIN)}`],
          ],
        },
        ...numberSection,
        { title: "Aliases", text: "If the request carries an alias, no number is picked: the alias itself becomes the code (this page does not send one)." },
      ],
    },
    {
      id: "encode",
      title: "Turn It into Base62",
      icon: "hash",
      group: "code",
      inLabel: "number",
      status: st(reached),
      summary: o.code ?? "Number to 7 characters",
      sections: [
        {
          title: "How it works",
          text: "Divide the number by 62 again and again. Each remainder picks one character from 0-9, A-Z, a-z. The characters, read from the last remainder to the first, are the code. Base62 keeps links short and URL-safe: no symbols, no look-alike padding.",
        },
        { title: "Alphabet", code: "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz" },
        ...encodeSection,
      ],
    },
    {
      id: "filter",
      title: "Tell the Code Filter",
      icon: "filter",
      group: "save",
      inLabel: "code",
      status: st(reached),
      summary: inspect ? (inspect.filter.mightContain ? "Filter knows the code" : "Not in the filter") : "Filter learns the code",
      sections: [
        {
          title: "What it does",
          text: "The code filter (a Bloom filter) answers one question without touching Redis or the database: could this code exist? It must learn the code BEFORE the row exists, so it can never miss a real code. When someone later opens a link that was never created, the filter turns them away straight away.",
        },
        ...(inspect
          ? [{ title: "This run", rows: [["filter says the code might exist", String(inspect.filter.mightContain)]] as [string, string][] }]
          : [NO_DEBUG]),
      ],
    },
    {
      id: "insert",
      title: "Save to Postgres",
      icon: "db",
      group: "save",
      inLabel: "code + URL",
      status: o.saved ? "success" : o.failedSave ? "error" : "idle",
      summary: inspect?.database ? "Row saved" : o.failedSave ? `Failed (${o.status})` : "INSERT into urls",
      verdict: o.failedSave ? { ok: false, text: `The service answered ${o.status}.` } : undefined,
      sections: [
        {
          title: "The query",
          code: "INSERT INTO urls (code, original_url, expires_at)\nVALUES ($1, $2, $3)\nON CONFLICT (code) DO NOTHING",
        },
        {
          title: "Why it is safe",
          text: "The unique constraint on code decides who gets a code, so this is safe with many app instances at once. If the code is already taken the insert adds no row. The service then picks another random code and tries again, up to 5 times. A clash is very rare: 3.4 trillion codes are possible.",
        },
        ...(inspect?.database
          ? [
              {
                title: "The row now in the database",
                rows: [
                  ["code", inspect.database.code],
                  ["original_url", inspect.database.originalUrl],
                  ["click_count", String(inspect.database.clickCount)],
                  ["expires_at", inspect.database.expiresAt ?? "never"],
                ] as [string, string][],
              },
            ]
          : [NO_DEBUG]),
      ],
    },
    {
      id: "clear",
      title: "Clear the Cache",
      icon: "trash",
      group: "save",
      inLabel: "saved",
      status: st(o.saved),
      summary: inspect ? (inspect.cache.kind === "not_cached" ? "Nothing cached yet" : inspect.cache.kind) : "Remove old Redis entry",
      sections: [
        {
          title: "What it does",
          text: "Deletes url:<code> and lease:<code> in Redis. A 'not found' answer may already be cached for this code (someone tried the link before it existed), and it must not hide the new link.",
        },
        ...(inspect
          ? [{ title: "This run", rows: [["what Redis holds for this code", inspect.cache.kind]] as [string, string][] }]
          : [NO_DEBUG]),
      ],
    },
    {
      id: "response",
      title: "Short URL Response",
      icon: "reply",
      inLabel: "201 Created",
      status: st(o.saved),
      summary: o.code ? (bodyOf(trace!).shortUrl ?? o.code) : "The short link",
      verdict: o.saved ? { ok: true, text: "Created. Your short URL is ready." } : undefined,
      sections: [
        { title: "What it does", text: "Sends back the code and the full short URL, plus when it expires (null means never)." },
        ...(trace?.response
          ? [
              { title: `Answer (${trace.response.status}, ${trace.durationMs} ms)`, code: JSON.stringify(trace.response.body, null, 2) },
              { title: "Headers", rows: Object.entries(trace.response.headers) as [string, string][] },
            ]
          : []),
      ],
    },
  ];

  return { atoms, groups: [{ id: "code", title: "Decide the code", icon: "dice" }, { id: "save", title: "Save the link", icon: "db" }] };
}
