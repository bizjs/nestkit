import { createClient } from 'redis';
export type RedisLockOptions = {
  redisUrl: string;
  connectionName?: string;
  onError?: (error: Error) => void;
};

export type LockResult = {
  release: () => Promise<boolean>;
  extendLockTTL: () => Promise<boolean>;
};

export class RedisLock {
  private readonly client: ReturnType<typeof createClient>;
  private connectionPromise?: Promise<void>;
  private closed = false;
  private closePromise?: Promise<void>;
  constructor(private readonly options: RedisLockOptions) {
    this.client = createClient({
      url: options.redisUrl,
      name: options.connectionName || 'redis-lock',
      disableOfflineQueue: true,
      socket: {
        connectTimeout: 5000,
        reconnectStrategy: (retries) => retries < 3 ? Math.min(50 * 2 ** retries, 500) : false,
      },
    });
    this.client.on('error', options.onError ?? console.error);
  }

  close(): Promise<void> {
    this.closed = true;
    return this.closePromise ??= this.closeClient();
  }

  private async closeClient(): Promise<void> {
    try {
      if (this.client.isReady) {
        await this.client.close();
      }
    } finally {
      // Stop pending connections/retries, or force cleanup if closing fails.
      if (this.client.isOpen) {
        this.client.destroy();
      }
    }
  }

  private async ensureConnected(): Promise<void> {
    this.assertOpen();
    if (!this.client.isReady) {
      this.connectionPromise ??= this.connectOrWait().finally(() => {
        this.connectionPromise = undefined;
      });
      await this.connectionPromise;
    }
    this.assertOpen();
  }

  private async connectOrWait(): Promise<void> {
    if (!this.client.isOpen) {
      await this.client.connect();
      return;
    }
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        this.client.off('ready', ready);
        this.client.off('error', failed);
        this.client.off('end', ended);
      };
      const ready = () => { cleanup(); resolve(); };
      const failed = (error: Error) => { cleanup(); reject(error); };
      const ended = () => failed(new Error('Redis connection is closed'));
      this.client.once('ready', ready);
      this.client.once('error', failed);
      this.client.once('end', ended);
    });
  }

  private assertOpen(): void {
    if (this.closed) {
      throw new Error('RedisLock is closed');
    }
  }

  async acquireLock(lockKey: string, ttlSeconds: number): Promise<LockResult | null> {
    await this.ensureConnected();
    this.assertOpen();
    const value = Math.random().toString();
    const result = await this.client.set(lockKey, value, { EX: ttlSeconds, NX: true });
    if (result === 'OK') {
      return {
        release: async () => {
          return this.releaseLock(lockKey, value);
        },
        extendLockTTL: async () => {
          await this.ensureConnected();
          this.assertOpen();
          const luaScript = `
            if redis.call("get", KEYS[1]) == ARGV[1] then
              return redis.call("expire", KEYS[1], ARGV[2])
            else
              return 0
            end
          `;
          const result = await this.client.eval(luaScript, { keys: [lockKey], arguments: [value, String(ttlSeconds)] });
          return result === 1;
        },
      };
    }
    return null;
  }

  private async releaseLock(lockKey: string, value: string): Promise<boolean> {
    await this.ensureConnected();
    this.assertOpen();
    const luaScript = `
    if redis.call("get", KEYS[1]) == ARGV[1] then
      return redis.call("del", KEYS[1])
    else
      return 0
    end
  `;
    const result = await this.client.eval(luaScript, { keys: [lockKey], arguments: [value] });
    return result === 1;
  }
}
