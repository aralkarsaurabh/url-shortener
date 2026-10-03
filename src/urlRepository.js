import { pool } from './db.js';
import { encodeBase62 } from './base62.js';

// Take the next id from the sequence first, so the code can be built from it
// and the row is written with a single insert.
export async function createUrl(originalUrl) {
  const { rows } = await pool.query("SELECT nextval(pg_get_serial_sequence('urls', 'id')) AS id");
  const id = rows[0].id;
  const code = encodeBase62(id);
  await pool.query('INSERT INTO urls (id, code, original_url) VALUES ($1, $2, $3)', [
    id,
    code,
    originalUrl,
  ]);
  return code;
}

export async function findUrlByCode(code) {
  const { rows } = await pool.query('SELECT original_url FROM urls WHERE code = $1', [code]);
  return rows[0]?.original_url ?? null;
}

export async function incrementClicks(code) {
  await pool.query('UPDATE urls SET click_count = click_count + 1 WHERE code = $1', [code]);
}

export async function getStats(code) {
  const { rows } = await pool.query(
    'SELECT code, original_url, click_count FROM urls WHERE code = $1',
    [code],
  );
  if (!rows[0]) return null;
  return {
    code: rows[0].code,
    originalUrl: rows[0].original_url,
    clickCount: Number(rows[0].click_count),
  };
}
