// Needs the Redis container from docker-compose. Skipped when Redis is not reachable.
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import Redis from 'ioredis';
import { createClickCounter } from '../src/clickCounter.js';

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
beforeEach(async () => {
  if (available) await redis.del('clicks:pending', 'clicks:inflight', 'clicks:inflight:id');
});
after(async () => {
  if (available) await redis.del('clicks:pending', 'clicks:inflight', 'clicks:inflight:id');
  redis.disconnect();
});

// Behaves like the real table: a batch id that was already applied is skipped.
function fakeRepository({ failTimes = 0, failAfterApplying = false } = {}) {
  const totals = new Map();
  const applied = new Set();
  const batches = [];
  let failuresLeft = failTimes;
  return {
    totals,
    batches,
    async applyClickBatch(batchId, counts) {
      batches.push({ batchId, counts });
      if (failuresLeft > 0 && !failAfterApplying) {
        failuresLeft--;
        throw new Error('database down');
      }
      const isNew = !applied.has(batchId);
      if (isNew) {
        applied.add(batchId);
        for (const { code, count } of counts) totals.set(code, (totals.get(code) ?? 0) + count);
      }
      if (failuresLeft > 0) {
        failuresLeft--;
        throw new Error('connection lost after the batch was saved');
      }
      return isNew;
    },
  };
}

const newCounter = (repository, overrides = {}) =>
  createClickCounter({ redis, repository, intervalMs: 60000, maxClicks: 1000, ...overrides });

test('clicks for the same code are added up into one batch', async (t) => {
  if (!available) return t.skip('redis not reachable');
  const repository = fakeRepository();
  const counter = newCounter(repository);

  for (const code of ['a', 'a', 'b', 'a', 'b']) await counter.record(code);
  assert.equal(await counter.flush(), 5);

  assert.equal(repository.batches.length, 1);
  assert.deepEqual(repository.totals, new Map([['a', 3], ['b', 2]]));
  assert.equal(await redis.exists('clicks:pending', 'clicks:inflight'), 0);
});

test('flushing with nothing waiting does not touch the database', async (t) => {
  if (!available) return t.skip('redis not reachable');
  const repository = fakeRepository();
  assert.equal(await newCounter(repository).flush(), 0);
  assert.equal(repository.batches.length, 0);
});

test('100 clicks recorded at once are all counted', async (t) => {
  if (!available) return t.skip('redis not reachable');
  const repository = fakeRepository();
  const counter = newCounter(repository);

  await Promise.all(Array.from({ length: 100 }, () => counter.record('hot')));
  await counter.flush();

  assert.equal(repository.totals.get('hot'), 100);
});

test('a failed save is retried with the same batch, and nothing is lost', async (t) => {
  if (!available) return t.skip('redis not reachable');
  const repository = fakeRepository({ failTimes: 1 });
  const counter = newCounter(repository);

  await counter.record('a');
  await counter.record('a');
  await assert.rejects(counter.flush(), /database down/);

  await counter.record('a'); // arrives while the failed batch is waiting
  await counter.flush(); // retries the failed batch
  await counter.flush(); // then saves the newer click

  assert.equal(repository.batches[0].batchId, repository.batches[1].batchId);
  assert.notEqual(repository.batches[1].batchId, repository.batches[2].batchId);
  assert.equal(repository.totals.get('a'), 3);
});

test('a batch that was saved but whose reply was lost is not counted twice', async (t) => {
  if (!available) return t.skip('redis not reachable');
  const repository = fakeRepository({ failTimes: 1, failAfterApplying: true });
  const counter = newCounter(repository);

  await counter.record('a');
  await counter.record('a');
  await assert.rejects(counter.flush(), /connection lost/);
  await counter.flush(); // same batch id is sent again, and the database skips it

  assert.equal(repository.batches.length, 2);
  assert.equal(repository.totals.get('a'), 2);
  assert.equal(await redis.exists('clicks:inflight'), 0);
});

test('reaching the click limit saves without waiting for the timer', async (t) => {
  if (!available) return t.skip('redis not reachable');
  const repository = fakeRepository();
  const counter = newCounter(repository, { maxClicks: 3 });

  for (let i = 0; i < 3; i++) await counter.record('a');
  await counter.flush(); // joins the save that the limit already started

  assert.equal(repository.totals.get('a'), 3);
  assert.equal(repository.batches.length, 1);
});

test('the timer saves clicks on its own', async (t) => {
  if (!available) return t.skip('redis not reachable');
  const repository = fakeRepository();
  const counter = newCounter(repository, { intervalMs: 30 });

  await counter.record('a');
  counter.start();
  await new Promise((r) => setTimeout(r, 150));
  await counter.stop();

  assert.equal(repository.totals.get('a'), 1);
});
