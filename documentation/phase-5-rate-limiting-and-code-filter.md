# Phase 5: Rate Limiting and Early Rejection of Unknown Codes

This phase was planned as "running it for real". Two things you asked for came first, so the plan was changed: this phase is now rate limiting plus the "is this a code we generate?" check, and Docker, health check, shutdown, several instances and load testing moved to phase 6.

## Part 1: Rate limiter

### What it does

Each client (by IP address) gets a fixed number of requests per minute, counted in Redis so every app instance shares one count.

| Limit | Applies to | Default |
| --- | --- | --- |
| `create` | `POST /shorten` | 10 per minute |
| `lookup` | `GET /:code` and `GET /stats/:code` | 300 per minute |

Over the limit the answer is `429` with the message from the assignment, `Too Many Requests: Try again later.`, in the usual error format (`error.code` is `RATE_LIMITED`). Every response also carries `RateLimit-Limit`, `RateLimit-Remaining` and `RateLimit-Reset` (seconds), and a `429` adds `Retry-After`.

### Decisions and why

- **Sliding window log in a Redis sorted set.** Every allowed request is stored with its time, and requests older than the window are dropped before counting. It is exact (no burst at a window boundary, unlike a counter that resets every minute), and memory is small because the limits are small. The cost is one entry per allowed request.
- **One Lua script does it all in one step.** Remove old entries, count, and add the new one cannot be split, or two requests at once could both slip in under the limit. Test: 50 simultaneous requests with a limit of 10 let exactly 10 through.
- **Redis supplies the clock** (`TIME` inside the script). Several app servers with slightly different clocks would otherwise disagree.
- **It runs before anything else on the route, even before the request body is read.** A flood of bad requests costs as little as possible. Test: an invalid body to a blocked client gets `429`, not `400`.
- **Creating and looking up have separate limits.** Creating is rare and costs a database write, so it is tight. Redirects are what the service is for, and many people can share one office IP, so that limit is generous.
- **Limits are per IP.** There is no login, so the IP is the only identity we have.
- **If Redis is down, requests are let through** and the problem is logged. This matches how the cache behaves: a failing helper should not take the service down. The cost is that there is no limiting while Redis is down.
- **`TRUST_PROXY`.** Behind a load balancer (the third project), every request would look like it comes from the balancer, and everyone would share one limit. `TRUST_PROXY=1` tells Express to take the client address from `X-Forwarded-For` (one proxy deep). It is `false` by default, because trusting that header when there is no proxy lets anyone fake their address and dodge the limit.

## Part 2: "Is this a code our system generates?"

Before a request reaches the cache or the database, it goes through two checks.

```
GET /:code
  1. rate limit
  2. format check        free, no Redis, no database
  3. code filter         one Redis round trip
  4. cache -> lease -> database (as before)
```

### Format check

A code must be 1 to 32 characters of letters, numbers, `-` and `_`, and must not be a reserved word (`shorten`, `stats`, `health`, `api`). Anything else is a `404` straight away.

This cannot be stricter. Generated codes are exactly 7 Base62 characters, but aliases are 3 to 32 characters with `-` and `_`, and links from phases 1 to 3 are Base62 and as short as one character. A tighter pattern would break those. The filter below is what tells real codes from made-up ones.

### Code filter (Bloom filter)

A Bloom filter is a compact bit array that remembers every code ever created. For a code it answers either "**definitely never created**" or "**maybe created**". There are no false "never created" answers by design, and a small share of never-created codes get "maybe".

- "Definitely never created" returns `404` at once. No cache entry, no lease, no database query.
- "Maybe" carries on as before. A false "maybe" costs one normal lookup, and its `404` is cached for 30 seconds.
- **Size.** Set by `BLOOM_EXPECTED_CODES` (default 1,000,000) and `BLOOM_FALSE_POSITIVE_RATE` (default 1%). That works out to 9,585,059 bits (about 1.2 MB) and 7 hash functions. If many more codes than expected are created, the false "maybe" rate rises (never the wrong "never created"). The size is part of the Redis key, so changing the settings starts a fresh filter, and the old keys can be deleted.
- **Hashing.** SHA-256 of the code gives two numbers, which give all 7 bit positions (double hashing).

### Never wrongly rejecting a real code

A wrong "never created" would break a real link, so the filter is built to avoid it:

| Risk | Protection |
| --- | --- |
| The filter has not been built yet, or Redis lost its data | A "ready" marker is saved only after a complete build. Without it, the filter always answers "maybe". |
| A code is created but the filter has not heard of it | The code is added **before** its row is inserted. If the insert then fails or loses a race, the filter just has a harmless extra entry. |
| The add to Redis fails | The ready marker is deleted (so the answer is "maybe" again) and a flag is set, so the next maintenance run rebuilds the filter from the database. |
| Redis cannot be reached | "Maybe", logged. Reads then work as in phase 2. |
| Several instances start at once | A short lock lets one build it. Building is safe to repeat anyway. |

Rebuilding reads every code from the database in id order, 5000 at a time. A maintenance check runs at startup and every 30 seconds (`BLOOM_CHECK_INTERVAL_MS`): if the filter is not ready, rebuild it.

Stats requests use the filter too: `GET /stats/:code` for a never-created code does not reach the database.

### Other decisions

- **Add before insert required a small change to the repository.** `createUrl` takes `beforeInsert(code)`, called for every code attempt (every retry, and for aliases).
- **No removal.** A Bloom filter cannot forget a code. That is fine here because codes are never deleted, and expired links must still answer `410`, not `404`.
- **Not done on purpose:** a per-IP penalty for lots of `404`s. The filter and the limiter together already make guessing codes expensive and not worth it.

## Config

`RATE_LIMIT_CREATE_PER_MINUTE`, `RATE_LIMIT_LOOKUP_PER_MINUTE`, `TRUST_PROXY`, `BLOOM_EXPECTED_CODES`, `BLOOM_FALSE_POSITIVE_RATE`, `BLOOM_CHECK_INTERVAL_MS` (see `.env.example`).

## Checked

- `npm test`: 83 pass, none skipped. New tests:
  - Rate limiter (real Redis): the limit then `429` with the assignment message and headers, separate clients, allowed again after the window, the window slides (old requests free one slot at a time), 50 at once with a limit of 10 gives exactly 10, and requests pass when Redis fails.
  - Filter (real Redis): size calculation, "maybe" before it is built, real codes pass and unknown ones are rejected after a build across several batches, false positive rate under 3% for a 1% setting, a code added before insert is found, losing the filter makes it "maybe" until rebuilt, a ready filter is not rebuilt, a failed add leads to "maybe" and a rebuild, and Redis being unreachable never throws.
  - Service, routes and repository: filter checked before the cache and the database (neither is touched for an unknown code), `beforeInsert` order, paging through codes, reserved words, 429 before the body is read, `TRUST_PROXY`.
- Live, real Postgres and Redis, on a separate port:
  - The server built the filter from 56 existing codes at startup.
  - A new link worked at once, and an old code from phase 1 (`1`) still returned `302`.
  - 600 never-created codes all returned `404`, created **0** cache entries and caused **0** database scans.
  - Deleting the ready marker (like a Redis that lost data) made an unknown code go through the cache and database as it should, and within one maintenance run the filter was rebuilt and rejected the next unknown code early. A real code still returned `302`.
  - Rate limits (10 per minute to create, 20 to look up, for the test): 12 creations gave ten `201` and two `429`, with `RateLimit-*` and `Retry-After: 60`. A second client was not affected. 25 redirects gave twenty `302` and five `429`. Redis held `rl:create:<ip>` and `rl:lookup:<ip>`, so the two limits are separate. The client address came from `X-Forwarded-For` with `TRUST_PROXY=1`.
- Measuring "database lookups" took several tries. Postgres's scan counters rise by a few on their own after startup, which first looked like false positives. With the server idle the counters rose by 4 with no requests, and after 600 never-created codes they did not move. One earlier run also showed a single stray `not found` cache entry that I could not reproduce in three later runs, and I do not know where it came from.
- Not checked: the filter at its real size (a million codes), two app instances at once, and the frontend (unchanged in this phase).

## Known limits

- With 56 codes in a filter sized for a million, the false "maybe" rate is effectively zero. The 1% figure applies only once it is nearly full.
- Limits are per IP. IPv6 users can switch between many addresses, so a real deployment should group them by their /64 prefix.
- If Redis is down there is no rate limiting.
- The limiter does not set its own limit differently for people who are signed in, because there is no sign-in.
- A code created while Redis is unreachable is still covered: the add fails, the ready marker cannot be reached either, and when Redis returns the instance deletes it and rebuilds. Until that run (up to 30 seconds), another instance that can reach Redis could answer "never created" for that one code.
