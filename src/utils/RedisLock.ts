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
  private closed = false;
  private closePromise?: Promise<void>;
  constructor(private readonly options: RedisLockOptions) {
    this.client = new Redis(options.redisUrl, {
      connectionName: options.connectionName || 'redis-lock',
      lazyConnect: true,
    });
    this.redisConnectPromise = this.client.connect();
    // Keep the rejection available to acquireLock without an unhandled rejection
    // if the client is closed before its first operation.
    void this.redisConnectPromise.catch(() => {});
  }

  close(): Promise<void> {
    this.closed = true;
    return this.closePromise ??= this.closeClient();
  }

  private async closeClient(): Promise<void> {
    try {
      if (this.client.status === 'ready') {
        await this.client.quit();
      }
    } finally {
      // Also stop pending connections/retries, or force cleanup if QUIT fails.
      this.client.disconnect();
    }
  }

  private assertOpen(): void {
    if (this.closed) {
      throw new Error('RedisLock is closed');
    }
  }

  async acquireLock(lockKey: string, ttlSeconds: number): Promise<LockResult | null> {
    this.assertOpen();
    await this.redisConnectPromise;
    this.assertOpen();
    const value = Math.random().toString();
    const result = await this.client.set(lockKey, value, 'EX', ttlSeconds, 'NX');
    if (result === 'OK') {
      return {
        release: async () => {
          return this.releaseLock(lockKey, value);
        },
        extendLockTTL: async () => {
          this.assertOpen();
          const luaScript = `
            if redis.call("get", KEYS[1]) == ARGV[1] then
              return redis.call("expire", KEYS[1], ARGV[2])
            else
              return 0
            end
          `;
          const result = await this.client.eval(luaScript, 1, lockKey, value, ttlSeconds);
          return result === 1;
        },
      };
    }
    return null;
  }

  private async releaseLock(lockKey: string, value: string): Promise<boolean> {
    this.assertOpen();
    await this.redisConnectPromise;
    this.assertOpen();
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
