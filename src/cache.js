import { randomUUID } from 'node:crypto';

// Stored in place of a URL. A real value can never match them because stored URLs start with http.
const NOT_FOUND = '__not_found__'; // the code does not exist
const GONE = '__gone__'; // the code existed but has expired

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
  redis.call('SET', KEYS[1], ARGV[2], 'PX', ARGV[3])
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

  // How long to keep an entry. A link that expires sooner than the normal TTL must leave the
  // cache at the moment it expires, so a cached redirect can never outlive the link.
  function ttlMsFor(entry) {
    if (entry.status === 'not_found') return notFoundTtlSeconds * 1000;
    const normal = ttlSeconds * 1000;
    return Math.max(1, Math.floor(Math.min(normal, entry.ttlMs ?? normal)));
  }

  return {
    // Returns one of:
    //   { status: 'hit', url }        cached URL
    //   { status: 'not_found' }       cached "this code does not exist"
    //   { status: 'gone' }            cached "this link has expired"
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
        if (payload === NOT_FOUND) return { status: 'not_found' };
        if (payload === GONE) return { status: 'gone' };
        return { status: 'hit', url: payload };
      }
      if (status === 'miss') return { status: 'miss', lease: payload };
      return { status: 'busy' };
    },

    // entry is { status: 'hit', url, ttlMs? } | { status: 'not_found' } | { status: 'gone' }.
    // ttlMs is the time left before the link expires. Returns false if the lease was no longer valid.
    async set(code, lease, entry) {
      const value =
        entry.status === 'hit' ? entry.url : entry.status === 'gone' ? GONE : NOT_FOUND;
      const stored = await redis.leaseSet(
        valueKey(code),
        leaseKey(code),
        lease,
        value,
        ttlMsFor(entry),
      );
      return stored === 1;
    },

    // For the debug tools: what is stored for this code, without taking a lease.
    async inspect(code) {
      const [value, ttlMs, lease] = await Promise.all([
        redis.get(valueKey(code)),
        redis.pttl(valueKey(code)),
        redis.exists(leaseKey(code)),
      ]);
      const kind = value === null ? 'not_cached' : value === NOT_FOUND ? 'not_found' : value === GONE ? 'gone' : 'url';
      return { kind, url: kind === 'url' ? value : null, ttlMs: value === null ? null : ttlMs, leaseHeld: lease === 1 };
    },

    // Drops the value and the lease, so a caller still holding the old lease cannot save stale data.
    async remove(code) {
      await redis.del(valueKey(code), leaseKey(code));
    },
  };
}
