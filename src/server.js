import os from 'node:os';
import { createApp } from './app.js';
import { pool } from './db.js';
import { redis } from './redis.js';
import { createCache } from './cache.js';
import { createClickCounter } from './clickCounter.js';
import { createCodeFilter } from './codeFilter.js';
import { createHealthCheck } from './health.js';
import { createRateLimiter } from './rateLimiter.js';
import { closeServer, createShutdown } from './shutdown.js';
import { createUrlService } from './urlService.js';
import * as repository from './urlRepository.js';

const port = process.env.PORT || 3000;
const baseUrl = process.env.BASE_URL || `http://localhost:${port}`;
const instanceId = process.env.INSTANCE_ID || os.hostname();

const cache = createCache({
  redis,
  ttlSeconds: Number(process.env.CACHE_TTL_SECONDS ?? 3600),
  notFoundTtlSeconds: Number(process.env.NOT_FOUND_TTL_SECONDS ?? 30),
  leaseTtlMs: Number(process.env.LEASE_TTL_MS ?? 5000),
});
const clicks = createClickCounter({
  redis,
  repository,
  intervalMs: Number(process.env.FLUSH_INTERVAL_MS ?? 5000),
  maxClicks: Number(process.env.FLUSH_MAX_CLICKS ?? 1000),
});
clicks.start();
const filter = createCodeFilter({
  redis,
  repository,
  expectedCodes: Number(process.env.BLOOM_EXPECTED_CODES ?? 1_000_000),
  falsePositiveRate: Number(process.env.BLOOM_FALSE_POSITIVE_RATE ?? 0.01),
  checkIntervalMs: Number(process.env.BLOOM_CHECK_INTERVAL_MS ?? 30000),
});
filter.start();
const service = createUrlService({ repository, cache, clicks, filter });

const windowMs = 60_000;
const limiters = {
  create: createRateLimiter({
    redis,
    name: 'create',
    limit: Number(process.env.RATE_LIMIT_CREATE_PER_MINUTE ?? 10),
    windowMs,
  }),
  lookup: createRateLimiter({
    redis,
    name: 'lookup',
    limit: Number(process.env.RATE_LIMIT_LOOKUP_PER_MINUTE ?? 300),
    windowMs,
  }),
};

// "false", "true", a number of proxies to trust (for example 1), or a subnet.
function parseTrustProxy(value) {
  if (value === undefined || value === 'false') return false;
  if (value === 'true') return true;
  return /^\d+$/.test(value) ? Number(value) : value;
}

// On a stop signal (for example docker stop): report unhealthy, finish the requests in progress,
// save the clicks still waiting in Redis, then close the connections and exit.
const shutdown = createShutdown({
  timeoutMs: Number(process.env.SHUTDOWN_TIMEOUT_MS ?? 10000),
  steps: [
    ['stop accepting requests', () => closeServer(server)],
    ['stop background jobs', () => Promise.all([filter.stop(), clicks.stop()])],
    ['save waiting clicks', () => clicks.flush()],
    ['close postgres', () => pool.end()],
    ['close redis', () => redis.quit()],
  ],
});

const server = createApp({
  service,
  baseUrl,
  limiters,
  trustProxy: parseTrustProxy(process.env.TRUST_PROXY),
  instanceId,
  checkHealth: createHealthCheck({ pool, redis }),
  isShuttingDown: shutdown.isShuttingDown,
}).listen(port, () => {
  console.log(`url-shortener ${instanceId} listening on ${baseUrl} (port ${port})`);
});

for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => shutdown.run(signal));
