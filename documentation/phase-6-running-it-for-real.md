# Phase 6: Running It for Real, Testing and Load Testing

## What we built

- A health check endpoint, `GET /health`.
- Graceful shutdown: on a stop signal the service finishes its work and saves waiting clicks before it exits.
- A Docker image for the service, and two instances of it in `docker-compose.yml`.
- An `X-Served-By` header, so you can see which instance answered.
- A script that checks several instances behave as one service (`loadtest/multi-instance.js`).
- A load test that runs the real code of every phase and compares them (`loadtest/compare.js`).

## How to run it

```
docker compose up -d                          # Postgres and Redis only (local development)
docker compose --profile app up -d --build    # also two app instances: :4000 and :4001
docker compose --profile app stop url-shortener-1 url-shortener-2

# checks across instances (needs these settings so each check can act as a different client)
TRUST_PROXY=1 RATE_LIMIT_LOOKUP_PER_MINUTE=20 RATE_LIMIT_CREATE_PER_MINUTE=1000 docker compose --profile app up -d
node url-shortener/loadtest/multi-instance.js http://localhost:4000 http://localhost:4001 --lookup-limit 20

# load test (needs Postgres and Redis, and port 3100 free)
cd url-shortener && node loadtest/compare.js --duration 10 --connections 50
```

The app instances are behind a Compose profile, so a plain `docker compose up -d` still starts only Postgres and Redis, as before.

## Health check

`GET /health` returns `{ status, instance, checks: { postgres, redis } }`.

| Status | HTTP | When |
| --- | --- | --- |
| `ok` | 200 | Postgres and Redis both answer |
| `degraded` | 200 | Redis is down, Postgres is fine |
| `unavailable` | 503 | Postgres is down |
| `shutting_down` | 503 | a stop signal was received |

- **Redis down is not a failure.** Without Redis the service still works (redirects read the database, clicks are written directly), only slower. If the check failed, a load balancer would pull every instance out at once and turn a slowdown into an outage. So it says `degraded` and stays in rotation.
- **Postgres down is a failure.** Links not in the cache would fail, and nothing can be created.
- **Each probe has a 2-second timeout**, so a hung dependency cannot hang the health check.
- **Not rate limited**, because load balancers call it constantly. `health` is also one of the reserved aliases.
- **`shutting_down` makes a load balancer stop sending traffic** while the instance finishes its work.

## Graceful shutdown

On `SIGTERM` (what `docker stop` sends) or `SIGINT` (Ctrl+C), in order:

1. Stop accepting new connections, and wait for requests already in progress. Idle keep-alive connections are closed so they do not hold things up.
2. Stop the background timers (click flush, code filter check).
3. Save the clicks still waiting in Redis to the database.
4. Close the Postgres pool.
5. Close the Redis connection, then exit with code 0.

A step that fails is logged and the rest still run, and the exit code is then 1. If everything takes longer than 10 seconds (`SHUTDOWN_TIMEOUT_MS`), it exits with 1. Docker waits 10 seconds by default before it kills a container, so the two limits match.

Step 3 is not needed for correctness, because waiting clicks stay safe in Redis for the next instance to save. It just means the database is up to date the moment the instance is gone, not up to 5 seconds later.

## Docker

- **Two stages, both `node:24-alpine`**, as the ES deployment guide describes for backends. The first installs only production dependencies with `npm ci --omit=dev --workspace url-shortener`, and the second copies the result and the source. The image is 256 MB.
- **Built from the repo root** (`docker build -f url-shortener/Dockerfile .`), because the lockfile covers all three workspaces. The other workspaces' `package.json` files are copied so `npm ci` accepts the lockfile.
- **Runs as the `node` user, not root.**
- **No secrets in the image.** `.dockerignore` keeps every `.env` file, the tests, the frontend and the docs out. Settings come from the environment, and `docker-compose.yml` has local development defaults.
- **The image has its own `HEALTHCHECK`** calling `/health`. It reports unhealthy only on 503 (Postgres down).
- **Postgres and Redis got health checks too**, and the app instances wait for both to be healthy before they start. Adding these made Compose recreate the two containers once. Their data lives in volumes and survived (96 rows before and after).
- **`BASE_URL` is the same for both instances** (`http://localhost:4000`). It is the public address of the service, because later a load balancer will sit in front of them. Links made by either instance are the same.
- **Instance names** come from `INSTANCE_ID` (here `url-shortener-1` and `-2`), or the container name by default.
- **Not done:** the ES pipeline (CodeBuild, ECR, EC2 through SSM). It was not asked for, and it needs AWS account details we do not have.

## Several instances behave as one service

`loadtest/multi-instance.js` against the two containers, all passing:

| Check | Result |
| --- | --- |
| Every instance is healthy, with different names | `url-shortener-1`, `url-shortener-2` |
| 20 links, each created on one instance and opened on the other straight away | all `302` (the filter and the cache are shared through Redis) |
| The same alias requested 20 times at once, spread over both instances | 1 created, 19 refused |
| One client alternating between instances, limit 20 a minute | 20 served, 10 blocked, so the limit is shared, not 20 each |
| 100 clicks on each instance | database says 200 |
| 7 more seconds later, past a flush | still 200, nothing counted twice |

Graceful shutdown in a container: 30 clicks sent to instance 1, then `docker stop` straight away. It stopped in 0.1 seconds with exit code 0, and the logs show all five steps. The database said 30 immediately afterwards, read through instance 2, which kept answering (`200`) while instance 1 refused connections.

## Load test

`loadtest/compare.js` checks out the real code of each phase from git, starts it against the same database, and measures it with `autocannon` (10 seconds, 50 connections). It resets Redis before every run, so every run starts with a cold cache. "Transactions" and "row updates" come from Postgres's own counters.

Everything ran on one laptop: the service, the load generator, Postgres and Redis (in Docker) share the same machine. Use the numbers to compare phases with each other, not as figures for a real deployment.

### Hot links: 10 existing links, requested over and over

First run, then second run in brackets.

| | Requests/s | p50 / p99 latency | DB transactions per 1000 requests | Row updates per 1000 requests |
| --- | --- | --- | --- | --- |
| Phase 1: database only | 26.0k (26.3k) | 1 / 3 ms | 911 | 0 |
| Phase 2: + Redis cache, click `UPDATE` on every click | 11.7k (11.7k) | 4 / 6 ms | 912 | 912 |
| Phase 3: + batched clicks | 42.3k (39.5k) | 1 / 2 ms | 1.0 | 9 to 10 |
| Phase 4: + validation, random codes | 42.0k (38.9k) | 1 / 2 ms | 1.0 | 10 |
| Now: + code filter and rate limiter | 20.5k (20.1k) | 2 / 4 ms | 1.1 | 10 |

### Unknown codes: random 7-character codes that were never created

| | Requests/s | DB transactions per 1000 requests |
| --- | --- | --- |
| Phase 4 (no filter) | 18.5k | 915 |
| Now (code filter) | 25.5k | 0.0 |

### Many different clients, each under the rate limit

| | Requests/s | p50 / p99 latency |
| --- | --- | --- |
| Phase 4 | 39.7k | 1 / 2 ms |
| Now | 19.7k | 2 / 5 ms |

### One client with the default limit (300 lookups a minute)

299 requests redirected, then 510,640 were answered `429` at 46.5k requests/s with no database work at all.

### What the numbers say

- **Caching alone made things worse (phase 2).** The Redis cache removed the database read, but every click became a database write. With 50 connections hitting 10 rows, that cost more than the cache saved: 11.7k requests/s against 26.0k with no cache at all.
- **Batching the clicks is what made the cache pay off (phase 3).** Database transactions fell from about 912 to about 1 per 1000 requests, and throughput went to 39 to 42k requests/s, about 1.5 times phase 1. One transaction per 1000 requests comes from `FLUSH_MAX_CLICKS=1000`, so at this speed the size limit triggers the saves, not the 5-second timer. A larger limit would lower it further.
- **Phase 4 costs nothing measurable** on the hot path.
- **The filter does what it was built for.** A flood of never-created codes caused 915 database transactions per 1000 requests in phase 4 and none now, and it was faster too.
- **The limiter rejects cheaply.** 429 answers ran at 46.5k requests/s, faster than serving a redirect, and touched neither the cache nor the database.
- **The filter and limiter together roughly halve the hot-link speed** (about 40k to about 20k requests/s, p50 1 ms to 2 ms), in both the single-client and many-client scenarios. I did not measure the two separately, so I cannot say how the cost splits. A likely cause is that each lookup now makes two more round trips to Redis (the filter check and the limiter), going from about two to about four. That is a guess I did not test.
- **A mistake along the way:** I first thought the slowdown came from the single client's rate limit log growing large, because that run used a limit of 100 million. The many-clients run, where every log has one entry, showed the same slowdown, so that was not the cause.
- **Run to run, the numbers vary by up to about 7%** (the hot links were measured twice).
- **A measurement oddity I did not resolve:** for phases 1 and 2 Postgres reported about 0.91 transactions per request, where I expected exactly 1.0. The difference from the other phases is large enough that it does not change any conclusion.

### Ideas, not done

- Check the cache before the code filter. A cache hit already proves the code is real, so only misses need the filter. That would save one Redis round trip on the hot path, but a flood of unknown codes would then take a lease for each one, so it needs thought.
- Put the limiter and the cache lookup in one Redis script, to save another round trip.
- Raise `FLUSH_MAX_CLICKS` to cut database transactions further, at the cost of fewer, larger batches.

## Checked

- `npm test`: 95 pass, none skipped (health check, shutdown order, a failing step, a forced exit after a hang, and a real server that lets a request finish while refusing new ones).
- The image builds and both instances run healthy, as the non-root user, with the data intact.
- The multi-instance script and the shutdown test above, against real containers.
- The load test, run twice for the hot links scenario.
- Not checked: a load balancer in front of the instances (that is the third project), more than two instances, and a failure of Postgres or Redis while the service is under load.

## Known limits

- There is no load balancer yet. When the round-robin project is built, point it at ports 4000 and 4001, set `TRUST_PROXY=1` so rate limits see real client addresses, and let it use `/health`.
- The deployment pipeline from the ES guide is not set up.
- Passwords in `docker-compose.yml` are local development defaults.
- The app containers are stopped at the end of this phase, so they hold no ports.
