import test from 'node:test';
import assert from 'node:assert/strict';
import { createUrlService } from '../src/urlService.js';

function setup({ cacheResults, dbUrl = 'https://example.com', counterError = null }) {
  const calls = { dbReads: 0, sets: [], removed: [], clicks: 0, counted: [] };
  const queue = [...cacheResults];
  const repository = {
    async createUrl() {
      return '7';
    },
    async findUrlByCode() {
      calls.dbReads++;
      return dbUrl;
    },
    async incrementClicks() {
      calls.clicks++;
    },
  };
  const cache = {
    async get() {
      const next = queue.shift();
      if (next instanceof Error) throw next;
      return next;
    },
    async set(code, lease, url) {
      calls.sets.push({ code, lease, url });
    },
    async remove(code) {
      calls.removed.push(code);
    },
  };
  const clicks = {
    async record(code) {
      if (counterError) throw counterError;
      calls.counted.push(code);
    },
  };
  const service = createUrlService({ repository, cache, clicks, busyRetries: 3, busyDelayMs: 1 });
  return { service, calls };
}

test('cache hit skips the database but still queues the click', async () => {
  const { service, calls } = setup({ cacheResults: [{ status: 'hit', url: 'https://cached.test' }] });
  assert.equal(await service.visit('a'), 'https://cached.test');
  assert.equal(calls.dbReads, 0);
  assert.deepEqual(calls.counted, ['a']);
  assert.equal(calls.clicks, 0); // queued in the counter, not written to the database
});

test('miss reads the database and fills the cache using the same lease', async () => {
  const { service, calls } = setup({ cacheResults: [{ status: 'miss', lease: 'L1' }] });
  assert.equal(await service.visit('a'), 'https://example.com');
  assert.deepEqual(calls.sets, [{ code: 'a', lease: 'L1', url: 'https://example.com' }]);
});

test('a code missing from the database is cached as not found and gets no click', async () => {
  const { service, calls } = setup({ cacheResults: [{ status: 'miss', lease: 'L1' }], dbUrl: null });
  assert.equal(await service.visit('a'), null);
  assert.deepEqual(calls.sets, [{ code: 'a', lease: 'L1', url: null }]);
  assert.deepEqual(calls.counted, []);
  assert.equal(calls.clicks, 0);
});

test('cached not found never touches the database', async () => {
  const { service, calls } = setup({ cacheResults: [{ status: 'not_found' }] });
  assert.equal(await service.visit('a'), null);
  assert.equal(calls.dbReads, 0);
});

test('busy waits, then uses the value the lease holder cached', async () => {
  const { service, calls } = setup({
    cacheResults: [{ status: 'busy' }, { status: 'busy' }, { status: 'hit', url: 'https://filled.test' }],
  });
  assert.equal(await service.visit('a'), 'https://filled.test');
  assert.equal(calls.dbReads, 0);
});

test('busy for too long falls back to the database without writing the cache', async () => {
  const { service, calls } = setup({ cacheResults: Array(4).fill({ status: 'busy' }) });
  assert.equal(await service.visit('a'), 'https://example.com');
  assert.equal(calls.dbReads, 1);
  assert.equal(calls.sets.length, 0);
});

test('a broken cache falls back to the database', async () => {
  const { service, calls } = setup({ cacheResults: [new Error('redis down')] });
  assert.equal(await service.visit('a'), 'https://example.com');
  assert.equal(calls.dbReads, 1);
});

test('creating a url clears any cached entry for the new code', async () => {
  const { service, calls } = setup({ cacheResults: [] });
  assert.equal(await service.createUrl('https://example.com'), '7');
  assert.deepEqual(calls.removed, ['7']);
});

test('if the click counter fails, the click is written to the database instead', async () => {
  const { service, calls } = setup({
    cacheResults: [{ status: 'hit', url: 'https://cached.test' }],
    counterError: new Error('redis down'),
  });
  assert.equal(await service.visit('a'), 'https://cached.test');
  assert.equal(calls.clicks, 1);
});
