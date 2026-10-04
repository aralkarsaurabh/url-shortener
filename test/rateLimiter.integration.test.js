// Needs the Redis container from docker-compose. Skipped when Redis is not reachable.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import Redis from 'ioredis';
import { createRateLimiter } from '../src/rateLimiter.js';
import { createMetrics } from '../src/metrics.js';

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

const uniqueName = () => `test${Date.now()}${Math.floor(Math.random() * 1e6)}`;

// A tiny app: one route behind the limiter. The client is named by the x-client header.
function startApp(options, client = redis) {
  const app = express();
  const limiter = createRateLimiter({
    redis: client,
    name: uniqueName(),
    keyFor: (req) => req.get('x-client') ?? 'anon',
    ...options,
  });
  app.get('/data', limiter, (req, res) => res.json({ ok: true }));
  const server = app.listen(0);
  const get = (clientName) =>
    fetch(`http://localhost:${server.address().port}/data`, { headers: { 'x-client': clientName } });
  return { server, get };
}

test('allows the limit, then answers 429 with the assignment message', async (t) => {
  if (!available) return t.skip('redis not reachable');
  const { server, get } = startApp({ limit: 5, windowMs: 60000 });
  t.after(() => server.close());

  for (let i = 1; i <= 5; i++) {
    const res = await get('alice');
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('ratelimit-limit'), '5');
    assert.equal(res.headers.get('ratelimit-remaining'), String(5 - i));
  }

  const blocked = await get('alice');
  assert.equal(blocked.status, 429);
  const body = await blocked.json();
  assert.equal(body.error.code, 'RATE_LIMITED');
  assert.equal(body.error.message, 'Too Many Requests: Try again later.');
  assert.equal(blocked.headers.get('ratelimit-remaining'), '0');
  const retryAfter = Number(blocked.headers.get('retry-after'));
  assert.ok(retryAfter >= 1 && retryAfter <= 60);
});

test('each client has its own limit', async (t) => {
  if (!available) return t.skip('redis not reachable');
  const { server, get } = startApp({ limit: 2, windowMs: 60000 });
  t.after(() => server.close());

  await get('alice');
  await get('alice');
  assert.equal((await get('alice')).status, 429);
  assert.equal((await get('bob')).status, 200);
});

test('requests are allowed again once the window has passed', async (t) => {
  if (!available) return t.skip('redis not reachable');
  const { server, get } = startApp({ limit: 2, windowMs: 300 });
  t.after(() => server.close());

  await get('alice');
  await get('alice');
  assert.equal((await get('alice')).status, 429);
  await new Promise((r) => setTimeout(r, 400));
  assert.equal((await get('alice')).status, 200);
});

test('the window slides: old requests free up one slot at a time', async (t) => {
  if (!available) return t.skip('redis not reachable');
  const { server, get } = startApp({ limit: 2, windowMs: 600 });
  t.after(() => server.close());

  await get('alice'); // t = 0
  await new Promise((r) => setTimeout(r, 350));
  await get('alice'); // t = 350
  assert.equal((await get('alice')).status, 429);
  await new Promise((r) => setTimeout(r, 300)); // t = 650: the first request left the window
  assert.equal((await get('alice')).status, 200);
  assert.equal((await get('alice')).status, 429); // the second is still inside it
});

test('50 requests at once with a limit of 10: exactly 10 get through', async (t) => {
  if (!available) return t.skip('redis not reachable');
  const { server, get } = startApp({ limit: 10, windowMs: 60000 });
  t.after(() => server.close());

  const statuses = (await Promise.all(Array.from({ length: 50 }, () => get('alice')))).map((r) => r.status);
  assert.equal(statuses.filter((s) => s === 200).length, 10);
  assert.equal(statuses.filter((s) => s === 429).length, 40);
});

test('if Redis fails, the request is let through', async (t) => {
  const broken = new Redis('redis://localhost:1', {
    lazyConnect: true,
    maxRetriesPerRequest: 0,
    enableOfflineQueue: false,
    retryStrategy: () => null,
  });
  broken.on('error', () => {});
  t.after(() => broken.disconnect());
  const { server, get } = startApp({ limit: 1, windowMs: 60000 }, broken);
  t.after(() => server.close());

  assert.equal((await get('alice')).status, 200);
  assert.equal((await get('alice')).status, 200);
});

test('the counters show allowed and blocked requests', async (t) => {
  if (!available) return t.skip('redis not reachable');
  const metrics = createMetrics();
  const name = uniqueName();
  const { server, get } = startApp({ limit: 2, windowMs: 60000, name, metrics });
  t.after(() => server.close());

  for (let i = 0; i < 5; i++) await get('alice');
  assert.deepEqual(metrics.snapshot(), { [`ratelimit.${name}.allowed`]: 2, [`ratelimit.${name}.blocked`]: 3 });
});
