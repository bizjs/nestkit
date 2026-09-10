import { Redis } from 'ioredis';
import { RedisLock } from '../../src';

jest.mock('ioredis', () => {
  return {
    Redis: jest.fn().mockImplementation(() => {
      return {
        set: jest.fn(),
        setex: jest.fn(),
        get: jest.fn(),
        del: jest.fn(),
        expire: jest.fn(),
        connect: jest.fn(),
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
