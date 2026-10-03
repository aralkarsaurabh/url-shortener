// Needs the Postgres container from docker-compose. Skipped when it is not reachable.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { AliasTakenError } from '../src/errors.js';

process.env.DATABASE_URL ??= 'postgres://postgres:postgres@localhost:5440/url_shortener';
const { pool } = await import('../src/db.js');
const repository = await import('../src/urlRepository.js');

let available = false;
before(async () => {
  try {
    await pool.query('SELECT 1 FROM click_batches LIMIT 1');
    available = true;
  } catch {
    available = false;
  }
});
after(() => pool.end());

test('a click batch adds to the counts, and a repeated batch id is skipped', async (t) => {
  if (!available) return t.skip('postgres not reachable');
  const a = await repository.createUrl({ url: 'https://example.com/batch-a' });
  const b = await repository.createUrl({ url: 'https://example.com/batch-b' });
  const batchId = `test-${Date.now()}-${Math.random()}`;

  assert.equal(
    await repository.applyClickBatch(batchId, [{ code: a, count: 5 }, { code: b, count: 2 }]),
    true,
  );
  assert.equal(await repository.applyClickBatch(batchId, [{ code: a, count: 5 }]), false);
  assert.equal(await repository.applyClickBatch(`${batchId}-2`, [{ code: a, count: 1 }]), true);

  assert.equal((await repository.getStats(a)).clickCount, 6);
  assert.equal((await repository.getStats(b)).clickCount, 2);
});

test('clicks for a code that does not exist are ignored', async (t) => {
  if (!available) return t.skip('postgres not reachable');
  const batchId = `test-${Date.now()}-${Math.random()}`;
  assert.equal(await repository.applyClickBatch(batchId, [{ code: 'nope-nope', count: 3 }]), true);
});

test('an empty batch is fine', async (t) => {
  if (!available) return t.skip('postgres not reachable');
  assert.equal(await repository.applyClickBatch(`test-${Date.now()}-${Math.random()}`, []), true);
});

const uniqueAlias = () => `t${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;

test('a generated code is random Base62 and can be looked up', async (t) => {
  if (!available) return t.skip('postgres not reachable');
  const code = await repository.createUrl({ url: 'https://example.com/generated' });
  assert.match(code, /^[0-9A-Za-z]{7}$/);
  assert.deepEqual(await repository.findUrlByCode(code), {
    url: 'https://example.com/generated',
    expiresAt: null,
  });
});

test('an alias is used as the code, and a second use of it is refused', async (t) => {
  if (!available) return t.skip('postgres not reachable');
  const alias = uniqueAlias();
  assert.equal(await repository.createUrl({ url: 'https://example.com/one', alias }), alias);
  await assert.rejects(repository.createUrl({ url: 'https://example.com/two', alias }), AliasTakenError);
  assert.equal((await repository.findUrlByCode(alias)).url, 'https://example.com/one');
});

test('20 requests for the same alias at once: exactly one wins', async (t) => {
  if (!available) return t.skip('postgres not reachable');
  const alias = uniqueAlias();
  const results = await Promise.allSettled(
    Array.from({ length: 20 }, (_, i) => repository.createUrl({ url: `https://example.com/${i}`, alias })),
  );
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.ok(results.filter((r) => r.status === 'rejected').every((r) => r.reason instanceof AliasTakenError));
});

test('a generated code that is already taken is skipped', async (t) => {
  if (!available) return t.skip('postgres not reachable');
  const taken = uniqueAlias();
  await repository.createUrl({ url: 'https://example.com/taken', alias: taken });
  const fresh = uniqueAlias();
  const sequence = [taken, taken, fresh];

  const code = await repository.createUrl({ url: 'https://example.com/new' }, () => sequence.shift());
  assert.equal(code, fresh);
  assert.equal((await repository.findUrlByCode(taken)).url, 'https://example.com/taken');
});

test('gives up if every generated code is taken', async (t) => {
  if (!available) return t.skip('postgres not reachable');
  const taken = uniqueAlias();
  await repository.createUrl({ url: 'https://example.com/taken', alias: taken });
  await assert.rejects(repository.createUrl({ url: 'https://example.com/x' }, () => taken), /unique code/);
});

test('expiry is saved and returned with the stats', async (t) => {
  if (!available) return t.skip('postgres not reachable');
  const expiresAt = new Date(Date.now() + 60_000);
  const code = await repository.createUrl({ url: 'https://example.com/expiring', expiresAt });
  assert.equal((await repository.findUrlByCode(code)).expiresAt.getTime(), expiresAt.getTime());
  assert.equal((await repository.getStats(code)).expiresAt.getTime(), expiresAt.getTime());
});
