// Read-only tools for the test frontend. Only switched on with ENABLE_DEBUG=true, because they
// show what is inside Redis and the database. Never turn them on for a public service.
export function createDebug({ cache, clicks, filter, repository, metrics, instanceId }) {
  return {
    // Everything the service knows about one code, in the order a request would meet it.
    async inspectCode(code) {
      const [mightContain, cached, waiting, row] = await Promise.all([
        filter.mightContain(code),
        cache.inspect(code),
        clicks.waitingFor(code),
        repository.getStats(code),
      ]);
      return {
        code,
        instance: instanceId,
        filter: { mightContain },
        cache: cached,
        clicks: { savedInDatabase: row?.clickCount ?? null, waitingInRedis: waiting },
        database: row,
      };
    },

    // Forget the cached value, so the next request has to go to the database.
    evictCode: (code) => cache.remove(code),

    counters: () => ({ instance: instanceId, sinceSeconds: metrics.sinceSeconds(), counts: metrics.snapshot() }),

    resetCounters: () => metrics.reset(),
  };
}
