// Needs the Redis container from docker-compose. Skipped when Redis is not reachable.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import Redis from 'ioredis';
import { createCodeFilter, bloomParams } from '../src/codeFilter.js';
import { randomCode } from '../src/codeGenerator.js';

const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6380', {
  lazyConnect: true,
  maxRetriesPerRequest: 1,
  retryStrategy: () => null,
});
redis.on('error', () => {});
let available = false;
const prefixes = [];

before(async () => {
  try {
    await redis.connect();
    await redis.ping();
    available = true;
  } catch {
    available = false;
  }
});
after(async () => {
  if (available) {
    for (const prefix of prefixes) {
      const keys = await redis.keys(`${prefix}:*`);
      if (keys.length) await redis.del(keys);
    }
  }
  redis.disconnect();
});

// Each test gets its own keys so tests cannot affect each other.
function setup(codes = [], overrides = {}) {
  const keyPrefix = `bloomtest${Date.now()}${Math.floor(Math.random() * 1e6)}`;
  prefixes.push(keyPrefix);
  const rows = codes.map((code, i) => ({ id: String(i + 1), code }));
  const repository = {
    scans: 0,
    async listCodesAfter(afterId, limit) {
      this.scans++;
      return rows.filter((r) => Number(r.id) > Number(afterId)).slice(0, limit);
    },
  };
  const filter = createCodeFilter({
    redis,
    repository,
    expectedCodes: 1000,
    falsePositiveRate: 0.01,
    keyPrefix,
    batchSize: 100,
    ...overrides,
  });
  return { filter, repository, keyPrefix, rows };
}

test('size follows the expected codes and the false positive rate', () => {
  assert.deepEqual(bloomParams(1_000_000, 0.01), { bits: 9585059, hashes: 7 });
  const small = bloomParams(1000, 0.01);
  assert.equal(small.bits, 9586);
  assert.equal(small.hashes, 7);
});

test('before it is built, it never says a code is missing', async (t) => {
  if (!available) return t.skip('redis not reachable');
  const { filter } = setup(['abc1234']);
  assert.equal(await filter.mightContain('abc1234'), true);
  assert.equal(await filter.mightContain('neverMade'), true);
});

test('once built from the database, real codes pass and unknown codes are rejected', async (t) => {
  if (!available) return t.skip('redis not reachable');
  const real = Array.from({ length: 250 }, randomCode); // more than one batch of 100
  const { filter } = setup(real);

  await filter.maintain();

  for (const code of real) assert.equal(await filter.mightContain(code), true);
  assert.equal(await filter.mightContain('definitelyNotThere'), false);
});

test('the false positive rate is close to what was asked for', async (t) => {
  if (!available) return t.skip('redis not reachable');
  const real = Array.from({ length: 1000 }, randomCode);
  const { filter } = setup(real);
  await filter.maintain();

  const realSet = new Set(real);
  let falsePositives = 0;
  let tried = 0;
  while (tried < 2000) {
    const code = randomCode();
    if (realSet.has(code)) continue;
    tried++;
    if (await filter.mightContain(code)) falsePositives++;
  }
  assert.ok(falsePositives / tried < 0.03, `false positive rate was ${falsePositives / tried}`);
});

test('a code added before the database insert is found', async (t) => {
  if (!available) return t.skip('redis not reachable');
  const { filter } = setup([]);
  await filter.maintain(); // built from an empty database
  assert.equal(await filter.mightContain('newcode1'), false);

  await filter.add('newcode1');
  assert.equal(await filter.mightContain('newcode1'), true);
});

test('losing the filter in Redis makes it say "maybe" until it is rebuilt', async (t) => {
  if (!available) return t.skip('redis not reachable');
  const { filter, keyPrefix } = setup(['abc1234']);
  await filter.maintain();
  assert.equal(await filter.mightContain('neverMade'), false);

  const keys = await redis.keys(`${keyPrefix}:*`);
  await redis.del(keys); // like a Redis that lost its data
  assert.equal(await filter.mightContain('neverMade'), true); // cannot be trusted now
  assert.equal(await filter.mightContain('abc1234'), true);

  await filter.maintain(); // rebuilds
  assert.equal(await filter.mightContain('neverMade'), false);
  assert.equal(await filter.mightContain('abc1234'), true);
});

test('a ready filter is not rebuilt again', async (t) => {
  if (!available) return t.skip('redis not reachable');
  const { filter, repository } = setup(['abc1234']);
  await filter.maintain();
  const scans = repository.scans;
  await filter.maintain();
  assert.equal(repository.scans, scans);
});

test('if an add fails, the filter stops saying "missing" and is rebuilt', async (t) => {
  if (!available) return t.skip('redis not reachable');
  const { filter, repository, keyPrefix } = setup(['abc1234']);
  await filter.maintain();

  // A client that fails on its first pipeline (the add) and works normally after that.
  let failNext = true;
  const failing = Object.create(redis);
  failing.pipeline = () => {
    if (failNext) {
      failNext = false;
      throw new Error('redis hiccup');
    }
    return redis.pipeline();
  };
  const brokenFilter = createCodeFilter({
    redis: failing,
    repository,
    expectedCodes: 1000,
    falsePositiveRate: 0.01,
    keyPrefix,
  });
  await brokenFilter.add('lostCode'); // fails, throws away the ready marker
  assert.equal(await filter.mightContain('lostCode'), true); // "maybe", not a wrong "missing"

  // The code now exists in the database, then maintenance rebuilds and includes it.
  repository.listCodesAfter = async (afterId) =>
    afterId === '0' ? [{ id: '1', code: 'abc1234' }, { id: '2', code: 'lostCode' }] : [];
  await brokenFilter.maintain(); // the one with the failed add still has missedAdds set
  assert.equal(await filter.mightContain('lostCode'), true);
  assert.equal(await filter.mightContain('neverMade'), false);
});

test('if Redis cannot be reached, it says "maybe" and does not throw', async (t) => {
  const broken = new Redis('redis://localhost:1', {
    lazyConnect: true,
    maxRetriesPerRequest: 0,
    enableOfflineQueue: false,
    retryStrategy: () => null,
  });
  broken.on('error', () => {});
  t.after(() => broken.disconnect());
  const filter = createCodeFilter({
    redis: broken,
    repository: { async listCodesAfter() { return []; } },
    expectedCodes: 1000,
    falsePositiveRate: 0.01,
    keyPrefix: 'unreachable',
  });

  assert.equal(await filter.mightContain('anything'), true);
  await filter.add('anything'); // must not throw
});
