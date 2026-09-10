import { Redis } from 'ioredis';
import { RedisLock } from '../../src';

jest.mock('ioredis', () => {
  return {
    Redis: jest.fn().mockImplementation(() => {
      return {
        status: 'ready',
        quit: jest.fn().mockResolvedValue('OK'),
        disconnect: jest.fn(),
        set: jest.fn(),
        setex: jest.fn(),
        get: jest.fn(),
        del: jest.fn(),
        expire: jest.fn(),
        connect: jest.fn().mockResolvedValue(undefined),
        eval: jest.fn(),
      };
    }),
  };
});

describe('RedisLock', () => {
  let redisLock: RedisLock;
  let redis: jest.Mocked<Redis>; // 这里使用 jest.Mocked 来模拟 Redis

  beforeEach(() => {
    redisLock = new RedisLock({ redisUrl: 'mock://localhost:6379' });
    redis = (Redis as any as jest.Mock).mock.results[0].value;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('closes the connection once across repeated and concurrent calls', async () => {
    await Promise.all([redisLock.close(), redisLock.close()]);
    await redisLock.close();
    expect(redis.quit).toHaveBeenCalledTimes(1);
    expect(redis.disconnect).toHaveBeenCalledTimes(1);
  });

  it.each(['wait', 'connecting', 'reconnecting', 'end'] as const)('closes a %s client without waiting for Redis', async status => {
    Object.defineProperty(redis, 'status', { value: status });
    await redisLock.close();
    expect(redis.quit).not.toHaveBeenCalled();
    expect(redis.disconnect).toHaveBeenCalledTimes(1);
  });

  it('disconnects even if graceful shutdown fails', async () => {
    const error = new Error('QUIT failed');
    redis.quit.mockRejectedValue(error);
    await expect(redisLock.close()).rejects.toBe(error);
    expect(redis.disconnect).toHaveBeenCalledTimes(1);
  });

  it('rejects new and existing lock operations after close', async () => {
    redis.set.mockResolvedValue('OK');
    const lock = await redisLock.acquireLock('key', 10);
    await redisLock.close();
    await expect(redisLock.acquireLock('key', 10)).rejects.toThrow('RedisLock is closed');
    await expect(lock!.release()).rejects.toThrow('RedisLock is closed');
    await expect(lock!.extendLockTTL()).rejects.toThrow('RedisLock is closed');
    expect(redis.set).toHaveBeenCalledTimes(1);
    expect(redis.eval).not.toHaveBeenCalled();
  });

  it('rejects a queued acquire when closing during reconnection', async () => {
    Object.defineProperty(redis, 'status', { value: 'reconnecting' });
    const error = new Error('Connection is closed.');
    let rejectCommand: (error: Error) => void;
    redis.set.mockImplementation(() => new Promise((_, reject) => { rejectCommand = reject; }) as any);
    redis.disconnect.mockImplementation(() => rejectCommand(error));
    const acquiring = redisLock.acquireLock('key', 10);
    const assertion = expect(acquiring).rejects.toBe(error);
    await redisLock.close();
    await assertion;
    expect(redis.disconnect).toHaveBeenCalledTimes(1);
    await expect(redisLock.acquireLock('key', 10)).rejects.toThrow('RedisLock is closed');
    expect(redis.set).toHaveBeenCalledTimes(1);
  });

  it('delegates lazy connection and bounded command retries to ioredis', () => {
    expect(redis.connect).not.toHaveBeenCalled();
    expect(Redis).toHaveBeenCalledWith('mock://localhost:6379', expect.objectContaining({
      lazyConnect: true,
      enableOfflineQueue: true,
      maxRetriesPerRequest: 3,
    }));
  });

  it('can acquire, renew and release after an earlier connection failure', async () => {
    const error = new Error('Reached the max retries per request limit');
    redis.set.mockRejectedValueOnce(error).mockResolvedValueOnce('OK');
    await expect(redisLock.acquireLock('key', 10)).rejects.toBe(error);

    // ioredis has reconnected; a new command must not await an old rejection.
    const lock = await redisLock.acquireLock('key', 10);
    expect(lock).not.toBeNull();
    redis.eval.mockResolvedValue(1);
    await expect(lock!.extendLockTTL()).resolves.toBe(true);
    await expect(lock!.release()).resolves.toBe(true);
    expect(redis.set).toHaveBeenCalledTimes(2);
    expect(redis.connect).not.toHaveBeenCalled();
  });

  it('should acquire lock successfully', async () => {
    const lockKey = 'testLock';
    const ttlSeconds = 10;

    redis.set.mockResolvedValue('OK');

    const lockResult = await redisLock.acquireLock(lockKey, ttlSeconds);
    expect(lockResult).not.toBeNull();
    expect(redis.set).toHaveBeenCalledWith(lockKey, expect.any(String), 'EX', ttlSeconds, 'NX');
  });

  it('should return null if lock cannot be acquired', async () => {
    const lockKey = 'testLock';
    const ttlSeconds = 10;

    // 模拟 Redis 的 set 操作，返回 null 表示锁无法获取
    redis.set.mockReturnValue(null);

    const lockResult = await redisLock.acquireLock(lockKey, ttlSeconds);

    expect(lockResult).toBeNull();
    expect(redis.set).toHaveBeenCalledWith(lockKey, expect.any(String), 'EX', ttlSeconds, 'NX');
  });

  it('should release the lock successfully when lock is owned', async () => {
    const lockKey = 'testLock';
    const ttlSeconds = 10;

    redis.set.mockResolvedValue('OK');
    const lockResult = await redisLock.acquireLock(lockKey, ttlSeconds);

    redis.eval.mockResolvedValue(1);
    const released = await lockResult.release();

    expect(released).toBe(true);
    expect(redis.eval).toHaveBeenCalledTimes(1);
  });

  it('should extend lock TTL successfully', async () => {
    const lockKey = 'testLock';
    const ttlSeconds = 10;

    redis.set.mockResolvedValue('OK');
    redis.eval.mockResolvedValue(1);

    const lockResult = await redisLock.acquireLock(lockKey, ttlSeconds);
    expect(lockResult).not.toBeNull();
    const token = redis.set.mock.calls[0][1];
    const result = await lockResult!.extendLockTTL();
    expect(result).toBe(true);
    expect(redis.eval).toHaveBeenCalledWith(expect.any(String), 1, lockKey, token, ttlSeconds);
    expect(redis.expire).not.toHaveBeenCalled();
  });

  it('should return false if extend TTL fails', async () => {
    const lockKey = 'testLock';
    const ttlSeconds = 10;

    redis.set.mockResolvedValue('OK');
    redis.eval.mockResolvedValue(0);

    const lockResult = await redisLock.acquireLock(lockKey, ttlSeconds);
    expect(lockResult).not.toBeNull();
    const token = redis.set.mock.calls[0][1];
    const result = await lockResult!.extendLockTTL();
    expect(result).toBe(false);
    expect(redis.eval).toHaveBeenCalledWith(expect.any(String), 1, lockKey, token, ttlSeconds);
    expect(redis.expire).not.toHaveBeenCalled();
  });

  it('should use the original owner token when renewing after another owner acquires the key', async () => {
    const random = jest.spyOn(Math, 'random');
    try {
      random.mockReturnValueOnce(0.1).mockReturnValueOnce(0.2);
      redis.set.mockResolvedValue('OK');
      const oldLock = await redisLock.acquireLock('shared-lock', 10);
      // The old lease has expired and Redis grants the same key to a new owner.
      const newLock = await redisLock.acquireLock('shared-lock', 20);
      expect(oldLock).not.toBeNull();
      expect(newLock).not.toBeNull();

      redis.eval.mockResolvedValueOnce(0).mockResolvedValueOnce(1);
      expect(await oldLock!.extendLockTTL()).toBe(false);
      expect(await newLock!.extendLockTTL()).toBe(true);

      const [, keyCount, key, token, ttl] = redis.eval.mock.calls[0];
      expect([keyCount, key, token, ttl]).toEqual([1, 'shared-lock', '0.1', 10]);
      expect(redis.eval.mock.calls[1].slice(1)).toEqual([1, 'shared-lock', '0.2', 20]);
      expect(redis.expire).not.toHaveBeenCalled();
    } finally {
      random.mockRestore();
    }
  });
});
