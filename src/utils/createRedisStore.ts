import { RedisStore } from 'connect-redis';
import Redis from 'ioredis';

export function createRedisStore(redisUrl: string, args: { prefix: string; connectionName?: string }) {
  const redis = new Redis(redisUrl, {
    connectionName: args.connectionName || 'session',
  });
  redis.on('error', (err) => {
    console.error(err);
  });

  const redisStore = new RedisStore({
    client: redis,
    prefix: args.prefix,
  });
  return redisStore;
}
