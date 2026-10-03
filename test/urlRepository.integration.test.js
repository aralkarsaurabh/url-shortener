// Needs the Postgres container from docker-compose. Skipped when it is not reachable.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';

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
  const a = await repository.createUrl('https://example.com/batch-a');
  const b = await repository.createUrl('https://example.com/batch-b');
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
