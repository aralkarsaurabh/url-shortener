import test from 'node:test';
import assert from 'node:assert/strict';
import { createDebug } from '../src/debug.js';
import { createMetrics } from '../src/metrics.js';

test('inspectCode gathers the filter, cache, clicks and database for one code', async () => {
  const metrics = createMetrics();
  metrics.inc('db.reads', 3);
  const debug = createDebug({
    instanceId: 'node-1',
    metrics,
    filter: { mightContain: async (code) => code === 'abc' },
    cache: { inspect: async () => ({ kind: 'url', url: 'https://example.com', ttlMs: 1234, leaseHeld: false }) },
    clicks: { waitingFor: async () => 4 },
    repository: {
      getStats: async (code) => ({ code, originalUrl: 'https://example.com', clickCount: 10, expiresAt: null }),
    },
  });

  assert.deepEqual(await debug.inspectCode('abc'), {
    code: 'abc',
    instance: 'node-1',
    filter: { mightContain: true },
    cache: { kind: 'url', url: 'https://example.com', ttlMs: 1234, leaseHeld: false },
    clicks: { savedInDatabase: 10, waitingInRedis: 4 },
    database: { code: 'abc', originalUrl: 'https://example.com', clickCount: 10, expiresAt: null },
  });
  assert.deepEqual(debug.counters().counts, { 'db.reads': 3 });
  debug.resetCounters();
  assert.deepEqual(debug.counters().counts, {});
});

test('a code that is not in the database has no database part', async () => {
  const debug = createDebug({
    instanceId: 'node-1',
    metrics: createMetrics(),
    filter: { mightContain: async () => false },
    cache: { inspect: async () => ({ kind: 'not_cached', url: null, ttlMs: null, leaseHeld: false }) },
    clicks: { waitingFor: async () => 0 },
    repository: { getStats: async () => null },
  });
  const result = await debug.inspectCode('nope');
  assert.equal(result.database, null);
  assert.equal(result.clicks.savedInDatabase, null);
  assert.equal(result.filter.mightContain, false);
});

test('evictCode asks the cache to forget the code', async () => {
  const evicted = [];
  const debug = createDebug({ cache: { remove: async (c) => evicted.push(c) }, metrics: createMetrics() });
  await debug.evictCode('abc');
  assert.deepEqual(evicted, ['abc']);
});
