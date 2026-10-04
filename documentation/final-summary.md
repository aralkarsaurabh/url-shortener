# URL Shortener: Final Summary

Six phases, each building on the last. Per-phase detail is in the other files in this folder.

| Phase | What was added | What it proved |
| --- | --- | --- |
| 1. Basic service | `POST /shorten`, `GET /:code`, Base62 codes, PostgreSQL | The simplest thing that works |
| 2. Cache, leases, clicks | Redis cache with TTL, leases, cached "not found", click counting | One request refills a missing entry (50 at once read the database once) |
| 3. Click batching | Clicks queued in Redis, saved in batches with batch ids | No loss and no double counting through failures; database transactions down by about 900 times |
| 4. Validation, aliases, expiry | Zod, random codes, aliases, expiry and `410`, one error format | The database decides who gets a code; a cached redirect cannot outlive its link |
| 5. Rate limit and code filter | Sliding window limiter, Bloom filter of created codes | A flood of never-created codes costs no database work |
| 6. Running it for real | Health check, graceful shutdown, Docker, two instances, load test | Several instances behave as one service |

## Results in one place

- Hot links, requests per second on one laptop: phase 1 about 26k, phase 2 about 12k, phase 3 about 40k, now about 20k.
- Database transactions per 1000 hot-link requests: about 910 in phases 1 and 2, about 1 from phase 3 on.
- Never-created codes: about 915 database transactions per 1000 requests before the filter, none after.
- Two instances: the rate limit, alias uniqueness, code filter and click counts are all shared, checked against real containers.
- Tests: 95 passing, many against real Postgres and Redis.

## Lessons

1. **A cache can make things worse until the writes around it are fixed.** Phase 2 was slower than phase 1 because every click was still a database write.
2. **Measure, and measure again.** Several of my first measurements were wrong: a stale server on the same port, a shell that did not split a variable, a counter that moves by itself, and a wrong theory about why the limiter was slow. Each was caught by looking at the raw numbers.
3. **Make helpers fail open, and say so.** The cache, click counter, filter and limiter all let requests through when Redis is down. The cost of each is written down in its phase document.
4. **Never let a shortcut give a wrong answer.** The code filter can say "maybe" wrongly but never "never created" wrongly, and every design choice there follows from that.
5. **Let the database arbitrate.** Unique codes, unique aliases and already-counted batches are all decided by a constraint in Postgres, so adding instances needed no extra coordination.
6. **Testing the failure cases found real bugs.** Stopping Postgres crashed the server (a missing error handler in phase 1 code), and that is the kind of bug a happy-path test never shows.

## Open items

- A load balancer in front of the instances (the round-robin project).
- The filter and limiter cost about half the hot-link speed; ideas are in the phase 6 document.
- The ES deployment pipeline.
- Rate limiting for IPv6 by /64 prefix, and a cleanup job for expired links.
