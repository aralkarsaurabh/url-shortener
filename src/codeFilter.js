import { createHash, randomUUID } from 'node:crypto';

// A Bloom filter of every code ever created, kept in Redis.
//   "definitely not created"  -> the request can be answered 404 with no cache or database call
//   "maybe created"           -> carry on as normal (a few percent of never-created codes land here)
// It can never wrongly say "not created" for a real code, because:
//   - a code is added BEFORE its row is inserted (an extra entry only costs a false "maybe"),
//   - it only answers "not created" once it has been fully built from the database ("ready"),
//   - if it cannot add a code or cannot reach Redis, it answers "maybe" and rebuilds later.

export function bloomParams(expectedCodes, falsePositiveRate) {
  const bits = Math.ceil((-expectedCodes * Math.log(falsePositiveRate)) / Math.LN2 ** 2);
  const hashes = Math.max(1, Math.round((bits / expectedCodes) * Math.LN2));
  return { bits, hashes };
}

// Double hashing: two numbers from one SHA-256 give all the bit positions.
function positionsFor(code, bits, hashes) {
  const digest = createHash('sha256').update(code).digest();
  const h1 = digest.readUInt32BE(0);
  const h2raw = digest.readUInt32BE(4);
  const h2 = h2raw % 2 === 0 ? h2raw + 1 : h2raw;
  return Array.from({ length: hashes }, (_, i) => (h1 + i * h2) % bits);
}

// pipeline.exec() reports each command's error in its result instead of throwing.
function unwrap(results) {
  const failed = results.find(([err]) => err);
  if (failed) throw failed[0];
  return results.map(([, value]) => value);
}

export function createCodeFilter({
  redis,
  repository,
  expectedCodes,
  falsePositiveRate,
  checkIntervalMs = 30000,
  keyPrefix = 'bloom:codes',
  batchSize = 5000,
}) {
  const { bits, hashes } = bloomParams(expectedCodes, falsePositiveRate);
  // The size is part of the key, so changing the settings starts a fresh filter.
  const bitsKey = `${keyPrefix}:${bits}:${hashes}`;
  const readyKey = `${bitsKey}:ready`;
  const lockKey = `${bitsKey}:building`;

  let missedAdds = false;
  let timer = null;
  let running = null;

  async function setBits(codes) {
    const pipeline = redis.pipeline();
    for (const code of codes) {
      for (const position of positionsFor(code, bits, hashes)) pipeline.setbit(bitsKey, position, 1);
    }
    unwrap(await pipeline.exec());
  }

  // Reads every code from the database in id order and adds it. Marks the filter ready at the end.
  async function rebuild() {
    missedAdds = false;
    let afterId = '0';
    let total = 0;
    for (;;) {
      const rows = await repository.listCodesAfter(afterId, batchSize);
      if (rows.length === 0) break;
      await setBits(rows.map((row) => row.code));
      afterId = rows[rows.length - 1].id;
      total += rows.length;
    }
    await redis.set(readyKey, '1');
    return total;
  }

  // If an add was missed, throw the filter away (so it answers "maybe"), then rebuild if it is not ready.
  async function maintain() {
    if (missedAdds) {
      await redis.del(readyKey);
      missedAdds = false;
    }
    if ((await redis.exists(readyKey)) === 1) return;
    const gotLock = await redis.set(lockKey, randomUUID(), 'PX', 120000, 'NX');
    if (!gotLock) return; // another instance is building it
    try {
      const total = await rebuild();
      console.log(`code filter built from ${total} codes`);
    } finally {
      await redis.del(lockKey);
    }
  }

  function maintainInBackground() {
    if (!running) {
      running = maintain()
        .catch((err) => console.error('code filter maintenance failed, will retry:', err.message))
        .finally(() => (running = null));
    }
    return running;
  }

  return {
    // false means "this code was definitely never created". Never throws.
    async mightContain(code) {
      try {
        const pipeline = redis.pipeline();
        for (const position of positionsFor(code, bits, hashes)) pipeline.getbit(bitsKey, position);
        pipeline.exists(readyKey);
        const values = unwrap(await pipeline.exec());
        if (values.pop() !== 1) return true; // not built yet, so it cannot be trusted
        return values.every((bit) => bit === 1);
      } catch (err) {
        console.error('code filter problem, treating the code as possible:', err.message);
        return true;
      }
    },

    // Call this before inserting the code into the database. Never throws.
    async add(code) {
      try {
        await setBits([code]);
      } catch (err) {
        console.error('code filter add failed, the filter will be rebuilt:', err.message);
        missedAdds = true;
        await redis.del(readyKey).catch(() => {});
      }
    },

    maintain: maintainInBackground,

    start() {
      maintainInBackground();
      timer = setInterval(maintainInBackground, checkIntervalMs);
      timer.unref();
    },

    async stop() {
      clearInterval(timer);
      await running;
    },
  };
}
