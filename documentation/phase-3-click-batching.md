# Phase 3: Click Queue and Batching

## What we built

Phase 2 cached the redirect, but every click still ran its own `UPDATE urls SET click_count = click_count + 1`. Now clicks are collected in Redis and saved to PostgreSQL in batches.

## How it works

```
redirect  ->  HINCRBY clicks:pending <code> 1      (Redis, no database call)

every 5 s, or after 1000 clicks:
  1. claim:   RENAME clicks:pending -> clicks:inflight, and give the batch an id
  2. save:    one transaction in PostgreSQL:
                insert the batch id into click_batches
                (id already there? skip the update)
                one UPDATE adding every code's count
  3. finish:  delete clicks:inflight, but only if it is still this batch's id
```

- Clicks for the same code are added up in Redis first, so 1000 clicks on one link become one row update.
- A save is one `UPDATE ... FROM unnest(...)` for all codes in the batch.

## Not losing or double counting clicks

| Failure | What happens |
| --- | --- |
| PostgreSQL is down during a save | The batch stays in `clicks:inflight`. The next flush gets the same batch and the same id, and tries again. New clicks keep collecting in `clicks:pending` meanwhile. |
| The batch was saved, but the reply was lost (crash before step 3) | The retry sends the same batch id. The id is already in `click_batches`, so the update is skipped. Counted once. |
| Two app instances flush at once | Both may get the same batch. The second one waits on the batch id in PostgreSQL, finds it already there, and skips. The "finish" step only deletes a batch if its id matches, so a slow instance cannot delete a newer batch. |
| The app crashes with clicks waiting | The clicks are in Redis, not in the app. Whichever instance flushes next picks them up. |
| Redis is down when a click arrives | The click is written straight to the database, like phase 2. |
| Redis crashes | Redis now runs with the append-only file on (and a volume), so waiting clicks survive a restart. A crash can still lose the last moment of writes. |

Old rows in `click_batches` are deleted after one day, in the same transaction.

## Decisions and why

- **A hash of counts, not a list of click events.** We only need totals per code. A hash keeps memory small and makes the batch smaller. We lose the individual click times, which phase 1 said we do not need.
- **Claim by renaming, in one Redis step.** `RENAME` moves everything waiting into a batch in one step, so a click can never be in both the old and the new batch.
- **A batch id saved in the same transaction as the counts.** That is what makes retries safe. Without it, retrying after a lost reply would count twice, and not retrying would risk losing clicks.
- **Two triggers: a timer (5 s) and a size limit (1000 clicks).** The timer bounds how old a count can get. The limit stops Redis piling up under heavy traffic. The limit is counted per app instance.
- **One flush at a time per process.** If a flush is already running, callers join it instead of starting another.
- **Timer is `unref`'d.** It never keeps the process alive on its own.
- **`/stats/:code` can be up to one flush interval behind.** It still reads only the database. We chose a stale-but-correct number over mixing Redis and database counts, which could briefly count a batch twice.
- **Counts for unknown codes are dropped by the `UPDATE`.** Clicks are only recorded for codes that were found, so this is only a safety net.
- **No flush on shutdown.** Not needed: waiting clicks stay safe in Redis. Phase 5 adds graceful shutdown anyway.

## A bug found on the way (phase 1 code)

While testing a Postgres outage, the whole server exited. `src/db.js` had no `error` listener on the connection pool, and Node exits on an unhandled `error` event when Postgres drops an idle connection. We added `pool.on('error', ...)`. Redis already had a listener. Without the fix, the "Postgres is down" protection above would never have been reachable.

## Config

`FLUSH_INTERVAL_MS` (default 5000), `FLUSH_MAX_CLICKS` (default 1000). See `.env.example`.

## Checked

- `npm test`: 30 pass, none skipped. New tests:
  - Counter against real Redis: clicks added up into one batch, empty flush does nothing, 100 concurrent clicks all counted, failed save retried with the same batch and nothing lost, saved-but-reply-lost batch not counted twice, size limit triggers a flush, timer flushes on its own.
  - Repository against real Postgres: batch adds counts, repeated batch id skipped, unknown code ignored, empty batch.
  - Service: clicks go to the counter, and fall back to the database if the counter fails.
- Live (real Postgres and Redis):
  - 200 visits: Redis held `200`, the database showed `0` right away, and after the flush the database showed `200`.
  - Database `UPDATE` statements on `urls` for those 200 clicks: **1** (phase 2 would have run 200).
  - Postgres stopped, then 5 more visits: all returned `302`, the 5 clicks waited in `clicks:inflight`, and after Postgres started again the total was correct with nothing left over.
  - The second run is the one with the pool fix. The first run exited, which is how we found the bug.
- Not checked: heavy load, or two app instances running at once (the reasoning above is covered by the batch id test, but not run with two real processes).

## Known limits

- Counts lag by up to the flush interval (5 s).
- We keep only totals per link, not the time of each click.
- A Redis crash can lose the last moment of clicks even with the append-only file.
