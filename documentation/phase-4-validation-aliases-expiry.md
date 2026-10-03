# Phase 4: Validation, Aliases, Expiry and Safer Codes

## What we built

- Request validation with Zod, before any business logic runs.
- Random, unguessable short codes (replacing the sequential ones from phase 1).
- Custom aliases (`"alias": "my-link"`).
- Link expiry (`"expiresInSeconds": 3600`), answered with `410 Gone` after the time is up.
- One error format for every failure, with proper status codes.

## API now

`POST /shorten` takes:

| Field | Required | Rules |
| --- | --- | --- |
| `url` | yes | trimmed, at most 2048 characters, `http` or `https` only, no username or password in it |
| `alias` | no | 3 to 32 characters of letters, numbers, `-` and `_`. Not `shorten`, `stats`, `health` or `api` (any capitalisation). Case sensitive. |
| `expiresInSeconds` | no | whole number from 1 to 31,536,000 (one year). Left out means it never expires. |

It returns `201` with `{ code, shortUrl, expiresAt }`. `GET /:code` returns `302`, `404` (unknown) or `410` (expired). `GET /stats/:code` now also returns `expiresAt`.

Every error has the same shape:

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "The request is not valid",
             "details": [ { "field": "alias", "message": "that alias is reserved" } ] } }
```

| Status | `error.code` | When |
| --- | --- | --- |
| 400 | `VALIDATION_ERROR` | bad field (every wrong field is listed in `details`) |
| 400 | `INVALID_JSON` | body is not valid JSON |
| 404 | `NOT_FOUND` | unknown code, malformed code, or unknown route |
| 409 | `ALIAS_TAKEN` | the alias is already used |
| 410 | `LINK_EXPIRED` | the link has expired |
| 413 | `PAYLOAD_TOO_LARGE` | body over 10 KB |
| 500 | `INTERNAL_ERROR` | anything unexpected (details are logged, not sent) |

**This changes the error format** from phase 1 to 3 (`{ "error": "text" }`). The test frontend was updated to read the new format.

## Decisions and why

- **Random codes instead of the row id.** Phase 1 made the code from the table's id, so codes ran in order (`1`, `2`, `3`) and anyone could walk through every link. Now each code is a random number between 62^6 and 62^7, written in Base62, which always gives exactly 7 characters (about 3.4 trillion possible codes). The Base62 function from phase 1 is still what writes them. Old links such as `1` and `2` keep working.
- **The database decides who gets a code, so many app instances are safe.** The insert uses `ON CONFLICT (code) DO NOTHING`. For a random code, a clash (very rare) just tries another code, up to 5 times. For an alias, a clash is a `409`. No app-level locking is needed, and a generated code can never take an alias's place or the other way round. Test: 20 requests for one alias at once give exactly one winner.
- **The same long URL gets a new code each time. This is deliberate.** Sharing one code per URL would mix up different people's links: they would share click counts, and one person's alias or expiry would apply to everyone. Each `POST` makes its own link. The cost is more rows when the same URL is shortened many times.
- **Aliases are the code itself.** No extra table or lookup. They go through the same cache, lease and click paths as generated codes. The pattern `GET /:code` accepts widened to `[A-Za-z0-9_-]`, up to 32 characters. Anything else is a `404` without touching Redis or Postgres.
- **Expired links answer `410 Gone`, not `404`.** The two mean different things to a client: "this existed and is over" and "this never existed". Expired links get no click counted. Their stats are still readable.
- **A cached redirect can never outlive its link.** Cache entries now use a millisecond TTL, and a link with an expiry is cached for the shorter of the normal TTL and the time it has left. So Redis drops the entry at the moment of expiry, the next request asks the database, and the database says it has expired. Without this, a link would keep redirecting for up to an hour after it expired.
- **"Gone" is cached like "not found".** Expiry never changes, so it is cached for the normal TTL, and expired links stop reaching the database.
- **Expired rows are not deleted.** Keeping them means stats still work and aliases cannot be reused by someone else. A cleanup job could be added later.
- **Zod checks the request at the edge.** Routes never see unchecked data. The error lists every wrong field in one go, not just the first.
- **URLs with a username or password are refused.** `https://trusted.com@evil.com` style links are a classic way to disguise a destination.
- **The URL is stored as given (trimmed), not rewritten.** Changing a user's URL is a surprise, and phase 4 does not need it.
- **Body limit of 10 KB.** The URL limit is 2 KB, so anything near 10 KB is not a real request.
- **Unknown routes return JSON, not an HTML page.** Same shape as every other error.
- **Small shape changes inside the code.** `createUrl` takes `{ url, alias, expiresAt }`, and `findUrlByCode` returns `{ url, expiresAt }`. The service's `visit` returns `{ status: 'found' | 'gone' | 'not_found' }`, and `createUrl` accepts the generator as a second argument so the "code already taken" path can be tested.

## Schema change

`ALTER TABLE urls ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;` (null means never). It is in `db/schema.sql` and safe to run again. For an existing database: `docker exec -i system-design-pg psql -U postgres url_shortener < url-shortener/db/schema.sql`.

## Checked

- `npm test`: 58 pass, none skipped. New or changed:
  - `schemas.test.js`: accepted and refused URLs (other schemes, credentials, empty, too long), alias rules and reserved names, expiry limits.
  - `codeGenerator.test.js`: 7 Base62 characters, no repeats, not in order.
  - `app.test.js`: every status code and error shape above.
  - `urlService.test.js`: expired and cached-gone paths, TTL passed to the cache, expiry still honoured when Redis is down.
  - `cache.integration.test.js` (real Redis): a link with an expiry leaves the cache when it expires, long expiries use the normal TTL, gone is cached.
  - `urlRepository.integration.test.js` (real Postgres): alias used as the code, 20 concurrent requests for one alias, taken generated code skipped, giving up after 5 clashes, expiry saved.
- Live, real Postgres and Redis, on a separate port:
  - Three generated codes were random (`7i1AaCT`, `P6RfCFQ`, `Q2oFuiH`).
  - Alias created, then the same alias returned `409`. A bad request listed all three wrong fields in one `400`. Bad JSON returned `400`.
  - 20 simultaneous requests for one alias: one `201`, nineteen `409`.
  - A 3-second link redirected, showed a Redis TTL of 2938 ms, and returned `410` after 3.5 seconds, with `__gone__` cached. Its stats still showed 1 click.
- Frontend: type check and lint pass. **Not checked:** the frontend against the new API (a development server of yours was already using the Next.js lock), and the new alias and expiry inputs in a real browser.

## Known limits

- Aliases are first come, first served, with no owners and no way to delete or edit a link.
- No rate limiting yet, so anyone can create unlimited links or grab aliases (phase 5 adds the rate limiter).
- Expired rows stay in the database.
- Short URLs shown by the API use `BASE_URL` from `.env`, so they point at port 3000 even if the service runs on another port.
