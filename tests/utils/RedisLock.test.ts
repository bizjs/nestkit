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

    // 模拟 Redis expire 操作，返回 1 表示 TTL 扩展成功
    redis.expire.mockResolvedValue(1);

    const lockResult = await redisLock.acquireLock(lockKey, ttlSeconds);
    if (lockResult) {
      const result = await lockResult.extendLockTTL();
      expect(result).toBe(true);
      expect(redis.expire).toHaveBeenCalledWith(lockKey, ttlSeconds);
    }
  });

  it('should return false if extend TTL fails', async () => {
    const lockKey = 'testLock';
    const ttlSeconds = 10;

    // 模拟 Redis expire 操作，返回 0 表示 TTL 扩展失败
    redis.expire.mockResolvedValue(0);

    const lockResult = await redisLock.acquireLock(lockKey, ttlSeconds);
    if (lockResult) {
      const result = await lockResult.extendLockTTL();
      expect(result).toBe(false);
      expect(redis.expire).toHaveBeenCalledWith(lockKey, ttlSeconds);
    }
  });
});
