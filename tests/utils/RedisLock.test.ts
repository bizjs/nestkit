import { createClient } from 'redis';
import { RedisLock } from '../../src';

jest.mock('redis', () => ({
  createClient: jest.fn(() => {
    const client = new (require('node:events').EventEmitter)();
    Object.assign(client, {
      isReady: true,
      isOpen: true,
      set: jest.fn(),
      eval: jest.fn(),
      connect: jest.fn(async () => { client.isOpen = true; client.isReady = true; }),
      close: jest.fn(async () => { client.isOpen = false; client.isReady = false; client.emit('end'); }),
      destroy: jest.fn(() => { client.isOpen = false; client.isReady = false; client.emit('end'); }),
    });
    return client;
  }),
}));

describe('RedisLock', () => {
  let lock: RedisLock;
  let client: any;
  beforeEach(() => {
    lock = new RedisLock({ redisUrl: 'redis://localhost:6379', onError: () => {} });
    client = (createClient as jest.Mock).mock.results.at(-1).value;
  });
  afterEach(() => jest.clearAllMocks());

  it('acquires with atomic NX and expiry options', async () => {
    client.set.mockResolvedValue('OK');
    expect(await lock.acquireLock('key', 10)).not.toBeNull();
    expect(client.set).toHaveBeenCalledWith('key', expect.any(String), { EX: 10, NX: true });
  });
  it('returns null for lock contention', async () => {
    client.set.mockResolvedValue(null);
    expect(await lock.acquireLock('key', 10)).toBeNull();
  });
  it.each([1, 0])('maps release/renewal result %i and supplies owner tokens', async result => {
    client.set.mockResolvedValue('OK');
    client.eval.mockResolvedValue(result);
    const acquired = await lock.acquireLock('key', 10);
    const token = client.set.mock.calls[0][1];
    expect(await acquired!.release()).toBe(result === 1);
    expect(client.eval).toHaveBeenLastCalledWith(expect.any(String), { keys: ['key'], arguments: [token] });
    expect(await acquired!.extendLockTTL()).toBe(result === 1);
    expect(client.eval).toHaveBeenLastCalledWith(expect.any(String), { keys: ['key'], arguments: [token, '10'] });
  });
  it('retains separate owner tokens for old and new locks', async () => {
    const random = jest.spyOn(Math, 'random').mockReturnValueOnce(0.1).mockReturnValueOnce(0.2);
    try {
      client.set.mockResolvedValue('OK');
      const old = await lock.acquireLock('key', 10);
      const current = await lock.acquireLock('key', 20);
      client.eval.mockResolvedValueOnce(0).mockResolvedValueOnce(1);
      expect(await old!.extendLockTTL()).toBe(false);
      expect(await current!.extendLockTTL()).toBe(true);
      expect(client.eval.mock.calls.map((call: any[]) => call[1])).toEqual([
        { keys: ['key'], arguments: ['0.1', '10'] }, { keys: ['key'], arguments: ['0.2', '20'] },
      ]);
    } finally { random.mockRestore(); }
  });
  it('shares the first connection across concurrent requests', async () => {
    client.isOpen = client.isReady = false;
    client.set.mockResolvedValue('OK');
    expect(client.connect).not.toHaveBeenCalled();
    await Promise.all([lock.acquireLock('a', 10), lock.acquireLock('b', 10)]);
    expect(client.connect).toHaveBeenCalledTimes(1);
    expect(client.set).toHaveBeenCalledTimes(2);
  });
  it('retries a failed initial connection on the next call', async () => {
    client.isOpen = client.isReady = false;
    const error = new Error('connection failed');
    client.connect.mockRejectedValueOnce(error);
    await expect(lock.acquireLock('key', 10)).rejects.toBe(error);
    client.set.mockResolvedValue('OK');
    expect(await lock.acquireLock('key', 10)).not.toBeNull();
    expect(client.connect).toHaveBeenCalledTimes(2);
  });
  it('waits for automatic reconnection without issuing connect twice', async () => {
    client.isReady = false;
    client.set.mockResolvedValue('OK');
    const acquiring = lock.acquireLock('key', 10);
    expect(client.set).not.toHaveBeenCalled();
    client.isReady = true;
    client.emit('ready');
    expect(await acquiring).not.toBeNull();
    expect(client.connect).not.toHaveBeenCalled();
    expect(client.listenerCount('ready')).toBe(0);
  });
  it('reports reconnect failure and allows a later recovered request', async () => {
    client.isReady = false;
    const acquiring = lock.acquireLock('key', 10);
    const error = new Error('reconnect failed');
    client.emit('error', error);
    await expect(acquiring).rejects.toBe(error);
    expect(client.listenerCount('ready')).toBe(0);
    client.isReady = true;
    client.set.mockResolvedValue('OK');
    expect(await lock.acquireLock('key', 10)).not.toBeNull();
  });
  it('does not cache command errors', async () => {
    const error = new Error('connection lost');
    client.set.mockRejectedValueOnce(error).mockResolvedValueOnce('OK');
    await expect(lock.acquireLock('key', 10)).rejects.toBe(error);
    expect(await lock.acquireLock('key', 10)).not.toBeNull();
  });
  it('closes once across repeated/concurrent calls', async () => {
    await Promise.all([lock.close(), lock.close()]);
    await lock.close();
    expect(client.close).toHaveBeenCalledTimes(1);
    expect(client.destroy).not.toHaveBeenCalled();
  });
  it('does not destroy an unopened client', async () => {
    client.isOpen = client.isReady = false;
    await lock.close();
    expect(client.close).not.toHaveBeenCalled();
    expect(client.destroy).not.toHaveBeenCalled();
  });
  it('interrupts reconnection and rejects pending work on close', async () => {
    client.isReady = false;
    const acquiring = lock.acquireLock('key', 10);
    const assertion = expect(acquiring).rejects.toThrow('closed');
    await lock.close();
    await assertion;
    expect(client.destroy).toHaveBeenCalledTimes(1);
    expect(client.set).not.toHaveBeenCalled();
  });
  it('destroys the connection when graceful closing fails', async () => {
    const error = new Error('close failed');
    client.close.mockRejectedValue(error);
    await expect(lock.close()).rejects.toBe(error);
    expect(client.destroy).toHaveBeenCalledTimes(1);
  });
  it('rejects acquire/release/renew after closing', async () => {
    client.set.mockResolvedValue('OK');
    const acquired = await lock.acquireLock('key', 10);
    await lock.close();
    await expect(lock.acquireLock('key', 10)).rejects.toThrow('RedisLock is closed');
    await expect(acquired!.release()).rejects.toThrow('RedisLock is closed');
    await expect(acquired!.extendLockTTL()).rejects.toThrow('RedisLock is closed');
    expect(client.eval).not.toHaveBeenCalled();
  });

  it('does not dispatch a command if closed between the readiness check and dispatch', async () => {
    const acquiring = lock.acquireLock('key', 10);
    const assertion = expect(acquiring).rejects.toThrow('RedisLock is closed');
    await lock.close();
    await assertion;
    expect(client.set).not.toHaveBeenCalled();
  });
});
