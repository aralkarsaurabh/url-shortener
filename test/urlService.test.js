import test from 'node:test';
import assert from 'node:assert/strict';
import { createUrlService } from '../src/urlService.js';

const NOW = 1_000_000;
const row = (extra = {}) => ({ url: 'https://example.com', expiresAt: null, ...extra });

function setup({ cacheResults, dbRow = row(), counterError = null }) {
  const calls = { dbReads: 0, sets: [], removed: [], clicks: 0, counted: [], created: null };
  const queue = [...cacheResults];
  const repository = {
    async createUrl(input) {
      calls.created = input;
      return input.alias ?? '7';
    },
    async findUrlByCode() {
      calls.dbReads++;
      return dbRow;
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
    async set(code, lease, entry) {
      calls.sets.push({ code, lease, entry });
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
  const service = createUrlService({
    repository,
    cache,
    clicks,
    busyRetries: 3,
    busyDelayMs: 1,
    now: () => NOW,
  });
  return { service, calls };
}

test('cache hit skips the database but still queues the click', async () => {
  const { service, calls } = setup({ cacheResults: [{ status: 'hit', url: 'https://cached.test' }] });
  assert.deepEqual(await service.visit('a'), { status: 'found', url: 'https://cached.test' });
  assert.equal(calls.dbReads, 0);
  assert.deepEqual(calls.counted, ['a']);
  assert.equal(calls.clicks, 0); // queued in the counter, not written to the database
});

test('miss reads the database and fills the cache using the same lease', async () => {
  const { service, calls } = setup({ cacheResults: [{ status: 'miss', lease: 'L1' }] });
  assert.deepEqual(await service.visit('a'), { status: 'found', url: 'https://example.com' });
  assert.deepEqual(calls.sets, [
    { code: 'a', lease: 'L1', entry: { status: 'hit', url: 'https://example.com' } },
  ]);
});

test('a code missing from the database is cached as not found and gets no click', async () => {
  const { service, calls } = setup({ cacheResults: [{ status: 'miss', lease: 'L1' }], dbRow: null });
  assert.deepEqual(await service.visit('a'), { status: 'not_found' });
  assert.deepEqual(calls.sets, [{ code: 'a', lease: 'L1', entry: { status: 'not_found' } }]);
  assert.deepEqual(calls.counted, []);
});

test('cached not found never touches the database', async () => {
  const { service, calls } = setup({ cacheResults: [{ status: 'not_found' }] });
  assert.deepEqual(await service.visit('a'), { status: 'not_found' });
  assert.equal(calls.dbReads, 0);
});

test('an expired link is gone, is cached as gone, and gets no click', async () => {
  const { service, calls } = setup({
    cacheResults: [{ status: 'miss', lease: 'L1' }],
    dbRow: row({ expiresAt: new Date(NOW - 1) }),
  });
  assert.deepEqual(await service.visit('a'), { status: 'gone' });
  assert.deepEqual(calls.sets, [{ code: 'a', lease: 'L1', entry: { status: 'gone' } }]);
  assert.deepEqual(calls.counted, []);
});

test('cached gone never touches the database', async () => {
  const { service, calls } = setup({ cacheResults: [{ status: 'gone' }] });
  assert.deepEqual(await service.visit('a'), { status: 'gone' });
  assert.equal(calls.dbReads, 0);
});

test('a link that has not expired yet is cached with the time it has left', async () => {
  const { service, calls } = setup({
    cacheResults: [{ status: 'miss', lease: 'L1' }],
    dbRow: row({ expiresAt: new Date(NOW + 5000) }),
  });
  assert.equal((await service.visit('a')).status, 'found');
  assert.equal(calls.sets[0].entry.ttlMs, 5000);
});

test('busy waits, then uses the value the lease holder cached', async () => {
  const { service, calls } = setup({
    cacheResults: [{ status: 'busy' }, { status: 'busy' }, { status: 'hit', url: 'https://filled.test' }],
  });
  assert.deepEqual(await service.visit('a'), { status: 'found', url: 'https://filled.test' });
  assert.equal(calls.dbReads, 0);
});

test('busy for too long falls back to the database without writing the cache', async () => {
  const { service, calls } = setup({ cacheResults: Array(4).fill({ status: 'busy' }) });
  assert.equal((await service.visit('a')).status, 'found');
  assert.equal(calls.dbReads, 1);
  assert.equal(calls.sets.length, 0);
});

test('a broken cache falls back to the database', async () => {
  const { service, calls } = setup({ cacheResults: [new Error('redis down')] });
  assert.equal((await service.visit('a')).status, 'found');
  assert.equal(calls.dbReads, 1);
});

test('a broken cache still honours expiry', async () => {
  const { service } = setup({
    cacheResults: [new Error('redis down')],
    dbRow: row({ expiresAt: new Date(NOW - 1) }),
  });
  assert.deepEqual(await service.visit('a'), { status: 'gone' });
});

test('creating a url clears any cached entry for the new code', async () => {
  const { service, calls } = setup({ cacheResults: [] });
  const result = await service.createUrl({ url: 'https://example.com' });
  assert.deepEqual(result, { code: '7', expiresAt: null });
  assert.deepEqual(calls.removed, ['7']);
});

test('creating a url turns expiresInSeconds into a date', async () => {
  const { service, calls } = setup({ cacheResults: [] });
  const { expiresAt } = await service.createUrl({
    url: 'https://example.com',
    alias: 'mine',
    expiresInSeconds: 60,
  });
  assert.equal(expiresAt.getTime(), NOW + 60_000);
  assert.deepEqual(calls.created, { url: 'https://example.com', alias: 'mine', expiresAt });
});

test('if the click counter fails, the click is written to the database instead', async () => {
  const { service, calls } = setup({
    cacheResults: [{ status: 'hit', url: 'https://cached.test' }],
    counterError: new Error('redis down'),
  });
  assert.equal((await service.visit('a')).status, 'found');
  assert.equal(calls.clicks, 1);
});
