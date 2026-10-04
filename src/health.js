// Returns an async function reporting whether Postgres and Redis answer within the timeout.
export function createHealthCheck({ pool, redis, timeoutMs = 2000 }) {
  async function probe(run) {
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('timed out')), timeoutMs);
    });
    try {
      await Promise.race([run(), timeout]);
      return 'ok';
    } catch {
      return 'down';
    } finally {
      clearTimeout(timer);
    }
  }

  return async function check() {
    const [postgres, redisStatus] = await Promise.all([
      probe(() => pool.query('SELECT 1')),
      probe(() => redis.ping()),
    ]);
    return { postgres, redis: redisStatus };
  };
}
