// Needs the Redis container from docker-compose. Skipped when Redis is not reachable.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import Redis from 'ioredis';
import { createCache } from '../src/cache.js';
import { createUrlService } from '../src/urlService.js';

const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6380', {
  lazyConnect: true,
  maxRetriesPerRequest: 1,
  retryStrategy: () => null,
});
redis.on('error', () => {});
let available = false;

before(async () => {
  try {
    await redis.connect();
    await redis.ping();
    available = true;
  } catch {
    available = false;
  }
});
after(() => redis.disconnect());

const newCache = (overrides = {}) =>
  createCache({ redis, ttlSeconds: 60, notFoundTtlSeconds: 60, leaseTtlMs: 2000, ...overrides });
const uniqueCode = () => `t${Date.now()}${Math.floor(Math.random() * 1e6)}`;

test('only one caller gets the lease, and only the holder can fill the cache', async (t) => {
  if (!available) return t.skip('redis not reachable');
  const cache = newCache();
  const code = uniqueCode();

  const first = await cache.get(code);
  assert.equal(first.status, 'miss');
  assert.equal((await cache.get(code)).status, 'busy');

  assert.equal(await cache.set(code, 'wrong-lease', { status: 'hit', url: 'https://bad.test' }), false);
  assert.equal((await cache.get(code)).status, 'busy');

  assert.equal(await cache.set(code, first.lease, { status: 'hit', url: 'https://good.test' }), true);
  assert.deepEqual(await cache.get(code), { status: 'hit', url: 'https://good.test' });
  await cache.remove(code);
});

test('a removed key invalidates a lease that is still out', async (t) => {
  if (!available) return t.skip('redis not reachable');
  const cache = newCache();
  const code = uniqueCode();

  const { lease } = await cache.get(code);
  await cache.remove(code);
  assert.equal(await cache.set(code, lease, { status: 'hit', url: 'https://stale.test' }), false);
  assert.equal((await cache.get(code)).status, 'miss');
  await cache.remove(code);
});

test('not found is cached', async (t) => {
  if (!available) return t.skip('redis not reachable');
  const cache = newCache();
  const code = uniqueCode();

  const { lease } = await cache.get(code);
  await cache.set(code, lease, { status: 'not_found' });
  assert.deepEqual(await cache.get(code), { status: 'not_found' });
  await cache.remove(code);
});

test('an expired lease can be taken again', async (t) => {
  if (!available) return t.skip('redis not reachable');
  const cache = newCache({ leaseTtlMs: 50 });
  const code = uniqueCode();

  const first = await cache.get(code);
  await new Promise((r) => setTimeout(r, 80));
  const second = await cache.get(code);
  assert.equal(second.status, 'miss');
  assert.equal(await cache.set(code, first.lease, { status: 'hit', url: 'https://late.test' }), false);
  await cache.remove(code);
});

test('50 requests at once for an uncached code read the database once', async (t) => {
  if (!available) return t.skip('redis not reachable');
  const code = uniqueCode();
  let dbReads = 0;
  const repository = {
    async findUrlByCode() {
      dbReads++;
      await new Promise((r) => setTimeout(r, 60));
      return { url: 'https://example.com/hot', expiresAt: null };
    },
    async incrementClicks() {},
  };
  const service = createUrlService({
    repository,
    cache: newCache(),
    clicks: { async record() {} },
    busyRetries: 40,
    busyDelayMs: 10,
  });

  const results = await Promise.all(Array.from({ length: 50 }, () => service.visit(code)));

  assert.ok(results.every((r) => r.status === 'found' && r.url === 'https://example.com/hot'));
  assert.equal(dbReads, 1);
  await newCache().remove(code);
});

test('a link that expires soon leaves the cache when it expires', async (t) => {
  if (!available) return t.skip('redis not reachable');
  const cache = newCache({ ttlSeconds: 3600 });
  const code = uniqueCode();

  const { lease } = await cache.get(code);
  await cache.set(code, lease, { status: 'hit', url: 'https://short-lived.test', ttlMs: 150 });
  assert.ok((await redis.pttl(`url:${code}`)) <= 150);
  assert.equal((await cache.get(code)).status, 'hit');

  await new Promise((r) => setTimeout(r, 250));
  const after = await cache.get(code);
  assert.equal(after.status, 'miss'); // gone from the cache, so the database decides
  await cache.remove(code);
});

test('a link with a long expiry still uses the normal ttl', async (t) => {
  if (!available) return t.skip('redis not reachable');
  const cache = newCache({ ttlSeconds: 60 });
  const code = uniqueCode();

  const { lease } = await cache.get(code);
  await cache.set(code, lease, { status: 'hit', url: 'https://long.test', ttlMs: 10 * 60 * 1000 });
  const ttl = await redis.pttl(`url:${code}`);
  assert.ok(ttl > 59_000 && ttl <= 60_000);
  await cache.remove(code);
});

test('gone is cached', async (t) => {
  if (!available) return t.skip('redis not reachable');
  const cache = newCache();
  const code = uniqueCode();

  const { lease } = await cache.get(code);
  await cache.set(code, lease, { status: 'gone' });
  assert.deepEqual(await cache.get(code), { status: 'gone' });
  await cache.remove(code);
});
