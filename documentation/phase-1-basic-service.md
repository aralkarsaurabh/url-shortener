# Phase 1: Basic Service

## What we built

A small Express service that stores a short code and the long URL in PostgreSQL.

- `POST /shorten` with `{ "url": "https://..." }` returns `201` and `{ "code", "shortUrl" }`.
- `GET /:code` redirects (`302`) to the original URL, or returns `404` if the code is unknown.
- Bad input (missing, not a URL, or not http/https) returns `400`.

There is no cache and no click counting yet. That is on purpose.

## How to run it

```
docker compose up -d          # from the repo root, starts Postgres on port 5440
cd url-shortener
npm start                     # uses .env (copy from .env.example)
npm test
```

## Files

| File | Job |
| --- | --- |
| `db/schema.sql` | The `urls` table. Docker runs it the first time Postgres starts. |
| `src/base62.js` | Turns a number into a short Base62 string, and back. |
| `src/urlRepository.js` | The only place that talks to the database. |
| `src/app.js` | Express routes and input checks. |
| `src/server.js` | Reads config and starts the server. |
| `test/` | Unit tests for Base62 and API tests for the routes. |

## Decisions and why

- **Own Postgres container via `docker-compose.yml`.** Other Postgres containers were already running for other projects, so we did not want to put our tables in them. The compose file is also where Redis will go in phase 2.
- **Short code comes from the row id.** We take the next number from the table's sequence, turn it into Base62, and insert the row with both. Every id is unique, so every code is unique, and we never have to retry on a clash. The cost: codes are guessable and run in order (`1`, `2`, `3`...). Phase 4 revisits this.
- **Routes take a `repository` object.** `createApp` is given the repository, so the API tests run with a simple in-memory version and need no database.
- **Only http and https URLs are accepted.** Otherwise someone could store `javascript:` links and have us redirect to them.
- **`302` redirect, not `301`.** Browsers cache a `301` for good, which would hide later phases (clicks, expiry) from repeat visitors.
- **Codes are checked against the Base62 pattern before the database is queried.** Junk paths return `404` without a database call.
- **ES modules and `node --env-file`.** No extra packages for config or watching. Only `express` and `pg` are installed.
- **Plain `pg` and one SQL file, no ORM.** One table and two queries do not justify more.

## Checked

- `npm test`: 5 tests pass.
- Against real Postgres: two URLs shortened (codes `1` and `2`), `GET /1` returned `302` with the right `Location`, an unknown code returned `404`, and both rows were present in the table.

## Known limits (handled in later phases)

- Every redirect reads from the database (phase 2).
- Short codes are sequential and easy to guess (phase 4).
- The same URL shortened twice gets two codes (phase 4).
- Validation is basic, with no length limit (phase 4).
