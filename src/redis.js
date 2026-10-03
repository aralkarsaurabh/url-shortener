import Redis from 'ioredis';

export const redis = new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: 1 });

redis.on('error', (err) => console.error('redis error:', err.message));
