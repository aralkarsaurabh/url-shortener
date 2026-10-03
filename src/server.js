import { createApp } from './app.js';
import { redis } from './redis.js';
import { createCache } from './cache.js';
import { createClickCounter } from './clickCounter.js';
import { createUrlService } from './urlService.js';
import * as repository from './urlRepository.js';

const port = process.env.PORT || 3000;
const baseUrl = process.env.BASE_URL || `http://localhost:${port}`;

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
const service = createUrlService({ repository, cache, clicks });

createApp({ service, baseUrl }).listen(port, () => {
  console.log(`url-shortener listening on ${baseUrl}`);
});
