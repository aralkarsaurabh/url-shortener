import { randomUUID } from 'node:crypto';
import { sendError } from './httpErrors.js';
import { noMetrics } from './metrics.js';

// Sliding window log: every allowed request is stored with its time, and requests older than
// the window are dropped before counting. Redis supplies the clock, so every app instance agrees.
// Returns { allowed (1 or 0), requests left, milliseconds until the oldest request leaves the window }.
const SLIDING_WINDOW = `
local t = redis.call('TIME')
local nowMs = t[1] * 1000 + math.floor(t[2] / 1000)
local windowMs = tonumber(ARGV[1])
local limit = tonumber(ARGV[2])
redis.call('ZREMRANGEBYSCORE', KEYS[1], 0, nowMs - windowMs)
local count = redis.call('ZCARD', KEYS[1])
if count >= limit then
  local oldest = redis.call('ZRANGE', KEYS[1], 0, 0, 'WITHSCORES')
  return {0, 0, math.floor(oldest[2] + windowMs - nowMs)}
end
redis.call('ZADD', KEYS[1], nowMs, ARGV[3])
redis.call('PEXPIRE', KEYS[1], windowMs)
local oldest = redis.call('ZRANGE', KEYS[1], 0, 0, 'WITHSCORES')
return {1, limit - count - 1, math.floor(oldest[2] + windowMs - nowMs)}
`;

// Express middleware allowing `limit` requests per `windowMs` for each client.
// `name` keeps separate limits apart (for example "create" and "lookup").
export function createRateLimiter({ redis, name, limit, windowMs, keyFor = (req) => req.ip, metrics = noMetrics }) {
  if (!redis.slidingWindow) redis.defineCommand('slidingWindow', { numberOfKeys: 1, lua: SLIDING_WINDOW });

  return async function rateLimit(req, res, next) {
    let result;
    try {
      result = await redis.slidingWindow(`rl:${name}:${keyFor(req)}`, windowMs, limit, randomUUID());
    } catch (err) {
      // If Redis is down we would rather serve requests than block everyone.
      console.error('rate limiter problem, letting the request through:', err.message);
      return next();
    }

    const [allowed, remaining, resetMs] = result;
    const resetSeconds = Math.max(1, Math.ceil(resetMs / 1000));
    res.set({
      'RateLimit-Limit': String(limit),
      'RateLimit-Remaining': String(remaining),
      'RateLimit-Reset': String(resetSeconds),
    });
    metrics.inc(`ratelimit.${name}.${allowed === 1 ? 'allowed' : 'blocked'}`);
    if (allowed === 1) return next();

    res.set('Retry-After', String(resetSeconds));
    sendError(res, 429, 'RATE_LIMITED', 'Too Many Requests: Try again later.');
  };
}
