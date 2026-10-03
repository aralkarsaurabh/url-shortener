const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function createUrlService({ repository, cache, busyRetries = 10, busyDelayMs = 25 }) {
  // Cache-aside read with leases. Returns the URL, or null if the code does not exist.
  async function resolve(code) {
    try {
      for (let attempt = 0; attempt <= busyRetries; attempt++) {
        const entry = await cache.get(code);
        if (entry.status === 'hit') return entry.url;
        if (entry.status === 'not_found') return null;
        if (entry.status === 'miss') {
          const url = await repository.findUrlByCode(code);
          await cache.set(code, entry.lease, url);
          return url;
        }
        await sleep(busyDelayMs); // busy: another request is filling the cache, so wait and look again
      }
    } catch (err) {
      console.error('cache problem, reading from the database instead:', err.message);
    }
    return repository.findUrlByCode(code);
  }

  return {
    async createUrl(originalUrl) {
      const code = await repository.createUrl(originalUrl);
      // A "not found" answer may already be cached for this new code, so clear it.
      await cache.remove(code).catch((err) => console.error('cache remove failed:', err.message));
      return code;
    },

    // Finds where the code points and counts the click. Returns null for an unknown code.
    async visit(code) {
      const url = await resolve(code);
      if (url) await repository.incrementClicks(code);
      return url;
    },

    getStats: (code) => repository.getStats(code),
  };
}
