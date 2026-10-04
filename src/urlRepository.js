import { pool } from './db.js';
import { randomCode } from './codeGenerator.js';
import { AliasTakenError } from './errors.js';

const MAX_CODE_ATTEMPTS = 5;

// The unique constraint on `code` decides who gets a code, so this is safe with many app
// instances at once. ON CONFLICT DO NOTHING returns no row when the code is already taken.
async function insertWithCode(code, originalUrl, expiresAt, beforeInsert) {
  await beforeInsert?.(code);
  const { rowCount } = await pool.query(
    `INSERT INTO urls (code, original_url, expires_at) VALUES ($1, $2, $3)
     ON CONFLICT (code) DO NOTHING`,
    [code, originalUrl, expiresAt],
  );
  return rowCount === 1;
}

// With an alias, the alias is the code, and a clash is an error for the caller.
// Without one, a random code is generated, and a clash (rare) just picks another code.
// beforeInsert(code) runs before every attempt, so the code filter learns about a code
// before its row exists.
export async function createUrl(
  { url, alias, expiresAt = null },
  { generate = randomCode, beforeInsert } = {},
) {
  if (alias) {
    if (!(await insertWithCode(alias, url, expiresAt, beforeInsert))) throw new AliasTakenError();
    return alias;
  }
  for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt++) {
    const code = generate();
    if (await insertWithCode(code, url, expiresAt, beforeInsert)) return code;
  }
  throw new Error('Could not generate a unique code');
}

export async function findUrlByCode(code) {
  const { rows } = await pool.query('SELECT original_url, expires_at FROM urls WHERE code = $1', [
    code,
  ]);
  if (!rows[0]) return null;
  return { url: rows[0].original_url, expiresAt: rows[0].expires_at };
}

// Used to build the code filter. Pages through every code in id order.
export async function listCodesAfter(afterId, limit) {
  const { rows } = await pool.query(
    'SELECT id, code FROM urls WHERE id > $1 ORDER BY id LIMIT $2',
    [afterId, limit],
  );
  return rows;
}

export async function incrementClicks(code) {
  await pool.query('UPDATE urls SET click_count = click_count + 1 WHERE code = $1', [code]);
}

export async function getStats(code) {
  const { rows } = await pool.query(
    'SELECT code, original_url, click_count, expires_at FROM urls WHERE code = $1',
    [code],
  );
  if (!rows[0]) return null;
  return {
    code: rows[0].code,
    originalUrl: rows[0].original_url,
    clickCount: Number(rows[0].click_count),
    expiresAt: rows[0].expires_at,
  };
}

// Adds a batch of clicks in one transaction. The batch id is saved in the same transaction,
// so a batch that is sent again (after a crash or a lost reply) is skipped, not counted twice.
// Returns true if the batch was added, false if it had already been added.
export async function applyClickBatch(batchId, counts) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rowCount } = await client.query(
      'INSERT INTO click_batches (batch_id) VALUES ($1) ON CONFLICT DO NOTHING',
      [batchId],
    );
    if (rowCount === 1 && counts.length > 0) {
      await client.query(
        `UPDATE urls SET click_count = click_count + v.n
         FROM (SELECT unnest($1::text[]) AS code, unnest($2::bigint[]) AS n) v
         WHERE urls.code = v.code`,
        [counts.map((c) => c.code), counts.map((c) => c.count)],
      );
    }
    await client.query("DELETE FROM click_batches WHERE applied_at < now() - interval '1 day'");
    await client.query('COMMIT');
    return rowCount === 1;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
