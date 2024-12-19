import { Redis } from 'ioredis';
export type RedisLockOptions = {
  redisUrl: string;
  connectionName?: string;
};

export type LockResult = {
  release: () => Promise<boolean>;
  extendLockTTL: () => Promise<boolean>;
};

export class RedisLock {
  private readonly redisConnectPromise: Promise<void>;
  private readonly client: Redis;
  constructor(private readonly options: RedisLockOptions) {
    this.client = new Redis(options.redisUrl, {
      connectionName: options.connectionName || 'redis-lock',
      lazyConnect: true,
    });
    this.redisConnectPromise = this.client.connect();
  }

  async acquireLock(lockKey: string, ttlSeconds: number): Promise<LockResult | null> {
    await this.redisConnectPromise;
    const value = Math.random().toString();
    const result = await this.client.set(lockKey, value, 'EX', ttlSeconds, 'NX');
    if (result === 'OK') {
      return {
        release: async () => {
          return this.releaseLock(lockKey, value);
        },
        extendLockTTL: async () => {
          const result = await this.client.expire(lockKey, ttlSeconds);
          return result === 1;
        },
      };
    }
    return null;
  }

  private async releaseLock(lockKey: string, value: string): Promise<boolean> {
    await this.redisConnectPromise;
    const luaScript = `
    if redis.call("get", KEYS[1]) == ARGV[1] then
      return redis.call("del", KEYS[1])
    else
      return 0
    end
  `;
    const result = await this.client.eval(luaScript, 1, lockKey, value);
    return result === 1;
  }
}
