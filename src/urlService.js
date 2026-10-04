import { noMetrics } from './metrics.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function createUrlService({
  repository,
  cache,
  clicks,
  filter,
  metrics = noMetrics,
  busyRetries = 10,
  busyDelayMs = 25,
  now = Date.now,
}) {
  // Turns a database row into what we cache and answer with.
  function entryFromRow(row) {
    if (!row) return { status: 'not_found' };
    if (!row.expiresAt) return { status: 'hit', url: row.url };
    const ttlMs = row.expiresAt.getTime() - now();
    if (ttlMs <= 0) return { status: 'gone' };
    return { status: 'hit', url: row.url, ttlMs };
  }

  const readDatabase = (code) => {
    metrics.inc('db.reads');
    return repository.findUrlByCode(code);
  };

  // Cache-aside read with leases. Returns { status: 'hit', url } | { status: 'gone' } | { status: 'not_found' }.
  async function resolve(code) {
    try {
      for (let attempt = 0; attempt <= busyRetries; attempt++) {
        const cached = await cache.get(code);
        metrics.inc(`cache.${cached.status}`);
        if (cached.status === 'miss') {
          const entry = entryFromRow(await readDatabase(code));
          await cache.set(code, cached.lease, entry);
          return entry;
        }
        if (cached.status !== 'busy') return cached; // hit, gone or not_found
        await sleep(busyDelayMs); // busy: another request is filling the cache, so wait and look again
      }
    } catch (err) {
      console.error('cache problem, reading from the database instead:', err.message);
    }
    return entryFromRow(await readDatabase(code));
  }

  // Clicks go to the counter (Redis) and are saved to the database in batches.
  // If Redis is down, write straight to the database so the click is not lost.
  async function recordClick(code) {
    try {
      await clicks.record(code);
      metrics.inc('clicks.queued');
    } catch (err) {
      metrics.inc('clicks.written_directly');
      console.error('click counter problem, writing the click to the database:', err.message);
      await repository.incrementClicks(code);
    }
  }

  return {
    // Throws AliasTakenError if the alias is already used.
    async createUrl({ url, alias, expiresInSeconds }) {
      const expiresAt = expiresInSeconds ? new Date(now() + expiresInSeconds * 1000) : null;
      // The filter must learn about the code before the row exists, so it never misses a real code.
      const code = await repository.createUrl(
        { url, alias, expiresAt },
        { beforeInsert: (candidate) => filter.add(candidate) },
      );
      // A "not found" answer may already be cached for this new code, so clear it.
      await cache.remove(code).catch((err) => console.error('cache remove failed:', err.message));
      return { code, expiresAt };
    },

    // Finds where the code points and counts the click.
    // Returns { status: 'found', url } | { status: 'gone' } | { status: 'not_found' }.
    async visit(code) {
      // Never created? Answer now, without touching the cache or the database.
      if (!(await filter.mightContain(code))) {
        metrics.inc('filter.rejected');
        return { status: 'not_found' };
      }
      metrics.inc('filter.passed');
      const entry = await resolve(code);
      if (entry.status !== 'hit') return { status: entry.status };
      await recordClick(code);
      return { status: 'found', url: entry.url };
    },

    async getStats(code) {
      if (!(await filter.mightContain(code))) return null;
      return repository.getStats(code);
    },
  };
}
