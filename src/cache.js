import { randomUUID } from 'node:crypto';

// Stored in place of a URL when the code does not exist in the database.
// A real value can never match it because stored URLs always start with http.
const NOT_FOUND = '__not_found__';

// One atomic step: return the cached value, or else try to take the lease for this key.
const LEASE_GET = `
local value = redis.call('GET', KEYS[1])
if value then return {'hit', value} end
if redis.call('SET', KEYS[2], ARGV[1], 'NX', 'PX', ARGV[2]) then return {'miss', ARGV[1]} end
return {'busy'}
`;

// Only save the value if the caller still holds the lease. Using the lease also clears it.
const LEASE_SET = `
if redis.call('GET', KEYS[2]) == ARGV[1] then
  redis.call('SET', KEYS[1], ARGV[2], 'EX', ARGV[3])
  redis.call('DEL', KEYS[2])
  return 1
end
return 0
`;

export function createCache({ redis, ttlSeconds, notFoundTtlSeconds, leaseTtlMs }) {
  redis.defineCommand('leaseGet', { numberOfKeys: 2, lua: LEASE_GET });
  redis.defineCommand('leaseSet', { numberOfKeys: 2, lua: LEASE_SET });

  const valueKey = (code) => `url:${code}`;
  const leaseKey = (code) => `lease:${code}`;

  return {
    // Returns one of:
    //   { status: 'hit', url }        cached URL
    //   { status: 'not_found' }       cached "this code does not exist"
    //   { status: 'miss', lease }     not cached, and the caller now holds the lease to fill it
    //   { status: 'busy' }            not cached, and someone else holds the lease
    async get(code) {
      const [status, payload] = await redis.leaseGet(
        valueKey(code),
        leaseKey(code),
        randomUUID(),
        leaseTtlMs,
      );
      if (status === 'hit') {
        return payload === NOT_FOUND ? { status: 'not_found' } : { status: 'hit', url: payload };
      }
      if (status === 'miss') return { status: 'miss', lease: payload };
      return { status: 'busy' };
    },

    // Pass url = null to cache "not found". Returns false if the lease was no longer valid.
    async set(code, lease, url) {
      const ttl = url === null ? notFoundTtlSeconds : ttlSeconds;
      const stored = await redis.leaseSet(
        valueKey(code),
        leaseKey(code),
        lease,
        url ?? NOT_FOUND,
        ttl,
      );
      return stored === 1;
    },

    // Drops the value and the lease, so a caller still holding the old lease cannot save stale data.
    async remove(code) {
      await redis.del(valueKey(code), leaseKey(code));
    },
  };
}
