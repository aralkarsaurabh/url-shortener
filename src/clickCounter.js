import { randomUUID } from 'node:crypto';
import { noMetrics } from './metrics.js';

const PENDING = 'clicks:pending'; // hash: code -> clicks waiting to be saved
const INFLIGHT = 'clicks:inflight'; // hash: the batch currently being saved
const INFLIGHT_ID = 'clicks:inflight:id'; // id of that batch

// Take the waiting clicks as one batch. If an earlier batch was never finished,
// hand that one out again instead, so it is retried with the same id.
const CLAIM_BATCH = `
local id = redis.call('GET', KEYS[3])
if id and redis.call('EXISTS', KEYS[2]) == 1 then return id end
if redis.call('EXISTS', KEYS[1]) == 1 then
  redis.call('RENAME', KEYS[1], KEYS[2])
  redis.call('SET', KEYS[3], ARGV[1])
  return ARGV[1]
end
return false
`;

// Remove the batch, but only if it is still the one we saved. A slower instance
// must not delete a newer batch.
const FINISH_BATCH = `
if redis.call('GET', KEYS[2]) == ARGV[1] then
  redis.call('DEL', KEYS[1], KEYS[2])
  return 1
end
return 0
`;

export function createClickCounter({ redis, repository, intervalMs, maxClicks, metrics = noMetrics }) {
  redis.defineCommand('claimClickBatch', { numberOfKeys: 3, lua: CLAIM_BATCH });
  redis.defineCommand('finishClickBatch', { numberOfKeys: 2, lua: FINISH_BATCH });

  let clicksSinceFlush = 0;
  let running = null;
  let timer = null;

  async function doFlush() {
    clicksSinceFlush = 0;
    const batchId = await redis.claimClickBatch(PENDING, INFLIGHT, INFLIGHT_ID, randomUUID());
    if (!batchId) return 0;

    const raw = await redis.hgetall(INFLIGHT);
    const counts = Object.entries(raw).map(([code, n]) => ({ code, count: Number(n) }));
    const applied = await repository.applyClickBatch(batchId, counts);
    await redis.finishClickBatch(INFLIGHT, INFLIGHT_ID, batchId);
    const total = counts.reduce((sum, c) => sum + c.count, 0);
    if (applied) {
      metrics.inc('clicks.batches_saved');
      metrics.inc('clicks.saved', total);
    }
    return total;
  }

  // Only one save runs at a time in this process. Resolves to the number of clicks saved.
  function flush() {
    if (!running) running = doFlush().finally(() => (running = null));
    return running;
  }

  function flushInBackground() {
    flush().catch((err) => console.error('click flush failed, will retry:', err.message));
  }

  return {
    // Clicks for this code that are still in Redis, waiting to be saved to the database.
    async waitingFor(code) {
      const [pending, inflight] = await Promise.all([
        redis.hget(PENDING, code),
        redis.hget(INFLIGHT, code),
      ]);
      return Number(pending ?? 0) + Number(inflight ?? 0);
    },

    async record(code) {
      await redis.hincrby(PENDING, code, 1);
      if (++clicksSinceFlush >= maxClicks) flushInBackground();
    },

    flush,

    start() {
      timer = setInterval(flushInBackground, intervalMs);
      timer.unref();
    },

    async stop() {
      clearInterval(timer);
      await running?.catch(() => {});
    },
  };
}
