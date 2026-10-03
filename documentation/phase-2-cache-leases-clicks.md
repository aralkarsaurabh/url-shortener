# Phase 2: Cache Layer, Leases and Click Counting

## What we built

- A Redis cache in front of PostgreSQL for redirects, with a TTL.
- Leases, so only one request refills a missing cache entry.
- Caching of "this code does not exist" for a short time.
- Click counting: a `click_count` column, and a new `GET /stats/:code` endpoint to read it.

Click counts are still written to the database on every click. That is deliberate. Phase 3 fixes it.

## How a redirect works now

```
GET /:code
  -> ask Redis (one atomic step)
       hit        -> use the cached URL
       not_found  -> 404, no database call
       miss       -> we got the lease:
                       read PostgreSQL
                       save to Redis, but only if our lease is still valid
       busy       -> someone else holds the lease:
                       wait 25 ms and ask Redis again (up to 10 times)
                       still nothing -> read PostgreSQL directly, do not touch the cache
  -> if the URL exists: add 1 to click_count in PostgreSQL
  -> 302 redirect
```

## Leases: what they do and why

A lease is a token Redis hands to the one request that is allowed to fill a missing cache entry. It solves two problems:

1. **Thundering herd.** When a popular key is missing or expires, many requests ask at once. Without leases they all hit the database. With leases, one reads the database and the rest wait for the cache to be filled. Test: 50 simultaneous requests for an uncached code read the database once.
2. **Stale writes.** A slow request could write an old value after a newer one. A save is only accepted if the caller's lease ID still matches. If the key was removed in the meantime, the lease is gone and the late write is rejected.

A lease expires on its own after 5 seconds (`LEASE_TTL_MS`), so a request that crashes while holding it cannot block the key forever.

## Decisions and why

- **Two small Lua scripts in Redis.** "Return the value, or else take the lease" and "save only if the lease matches" must each be one step. With separate commands two requests could both think they got the lease.
- **Not found is cached for 30 seconds** (`NOT_FOUND_TTL_SECONDS`). It is short because the code may be created soon after. It also stops repeated bad codes from hitting the database. Codes are sequential, so guessing them is easy.
- **Creating a URL clears its cache entry and lease.** Otherwise a cached "not found" for a code that was just created would keep returning 404.
- **If Redis fails, we read from the database.** Redis errors are logged and the request carries on. Checked by stopping the Redis container: redirects and click counts kept working. Without this, a cache problem would take the whole service down.
- **If we keep finding the key busy, we read the database but do not write the cache.** We do not hold the lease, so we are not allowed to.
- **`createUrlService` sits between the routes and the database.** The routes call `visit`, `createUrl` and `getStats`. The lease logic lives in one file and is tested with a fake cache.
- **Cache TTL is 1 hour** (`CACHE_TTL_SECONDS`). Nothing changes or deletes a URL yet, so a long TTL is safe. This must be revisited if we add edits or deletes. Use `cache.remove(code)` there.
- **Clicks are counted after the URL is found, and not for unknown codes.**
- **`/stats/:code` reads from the database**, not the cache, so counts are never stale.
- **The schema change is written to be safe to run again** (`ADD COLUMN IF NOT EXISTS`). Docker only runs `schema.sql` on a brand-new volume, so for an existing database run: `docker exec -i system-design-pg psql -U postgres url_shortener < url-shortener/db/schema.sql`.
- **`ioredis` with `maxRetriesPerRequest: 1`**, so a dead Redis fails fast instead of making requests hang.
- **Redis runs on port 6380** in `docker-compose.yml`, in case something else uses 6379.

## Config

`REDIS_URL`, `CACHE_TTL_SECONDS`, `NOT_FOUND_TTL_SECONDS`, `LEASE_TTL_MS` (see `.env.example`).

## Checked

- `npm test`: 19 pass, none skipped.
  - Unit tests of the service with a fake cache (hit, miss, not found, busy, busy too long, Redis error, create).
  - Tests of the cache against real Redis (one winner for the lease, wrong lease rejected, removed key voids a lease, expired lease can be retaken, not found cached, 50 concurrent requests cause one database read).
- Live, with real Postgres and Redis:
  - Before the first visit, Redis has no keys. After it, `url:<code>` exists with TTL 3600.
  - Three visits gave `clickCount: 3`.
  - An unknown code gave `404`, and Redis held `__not_found__` with TTL 30.
  - With Redis stopped, the redirect still returned `302` and the click was counted (`clickCount: 4`).
- Not checked: how it behaves under real load.

## Known limits (handled in later phases)

- Every click is still a database write (phase 3).
- If Redis is down, every request pays for the failed Redis call before reading the database (a circuit breaker could fix this, not planned).
- Waiting requests poll Redis every 25 ms instead of being notified. Simple, and fine at this size.
