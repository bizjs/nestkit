import { WrappedMemoryCache } from '../../src';
describe('WrappedMemoryCache', () => {
  test('getCachedValue ok', async () => {
    const errorHandle = jest.fn();
    const cache = new WrappedMemoryCache({
      ttl: 10 * 1000, // 10s
      refreshThreshold: 3 * 1000, // 3s
      refreshFn: (key) => {
        if (key === 'ok') {
          return Promise.resolve('ok');
        } else {
          return Promise.reject('error');
        }
      },
      onRefreshError: (key, error) => {
        errorHandle();
      },
    });

    let val = await cache.getCachedValue('ok');
    expect(val).toBe('ok');

    val = await cache.getCachedValue('error');
    expect(val).toBeUndefined();
    expect(errorHandle).toHaveBeenCalledTimes(1);
  });

  test('getCachedValue failed', async () => {
    const errorHandle = jest.fn();
    const cache = new WrappedMemoryCache({
      ttl: 10 * 1000, // 10s
      refreshThreshold: 3 * 1000, // 3s
      refreshFn: (key) => {
        return Promise.reject('error');
      },
      onRefreshError: (key, error) => {
        errorHandle();
      },
    });

    let val = await cache.getCachedValue('ok');
    expect(val).toBe(undefined);
    expect(errorHandle).toHaveBeenCalledTimes(1);

    val = await cache.getCachedValue('ok');
    expect(val).toBe(undefined);
    expect(errorHandle).toHaveBeenCalledTimes(2);
  });

  test('delCachedValue and refetch ok', async () => {
    let count = 0;

    const cache = new WrappedMemoryCache({
      ttl: 60 * 60 * 1000, // 1h
      refreshThreshold: 10 * 1000, // 10s
      refreshFn: (key) => {
        return Promise.resolve(count++);
      },
    });

    let val = await cache.getCachedValue('ok');
    expect(val).toBe(0);

    val = await cache.getCachedValue('ok');
    expect(val).toBe(0);

    await cache.delCachedValue('ok');

    val = await cache.getCachedValue('ok');
    expect(val).toBe(1);
  });

  test('del unexisted key', async () => {
    const cache = new WrappedMemoryCache({
      ttl: 60 * 60 * 1000, // 1h
      refreshThreshold: 10 * 1000, // 10s
      refreshFn: (key) => {
        return Promise.resolve(key);
      },
    });

    await cache.delCachedValue('unexisted');
  });
});

describe('WrappedMemoryCache refresh failures', () => {
  class InspectableCache extends WrappedMemoryCache {
    peek(key: string) {
      return this.cache.get(key);
    }
    refreshed() {
      return new Promise<void>(resolve => {
        const listener = () => {
          this.cache.off('refresh', listener);
          resolve();
        };
        this.cache.on('refresh', listener);
      });
    }
  }

  afterEach(() => jest.restoreAllMocks());

  test('failed background refresh preserves the old value without extending its lifetime', async () => {
    let now = Date.now();
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    const error = new Error('upstream unavailable');
    const loader = jest.fn().mockResolvedValueOnce('old').mockRejectedValue(error);
    const onRefreshError = jest.fn();
    const cache = new InspectableCache({
      ttl: 10000, refreshThreshold: 3000,
      refreshFn: loader, onRefreshError,
    });

    expect(await cache.getCachedValue('key')).toBe('old');
    now += 8000;
    const refreshed = cache.refreshed();
    expect(await cache.getCachedValue('key')).toBe('old');
    await refreshed;
    expect(await cache.peek('key')).toBe('old');
    expect(onRefreshError).toHaveBeenCalledTimes(1);
    expect(onRefreshError).toHaveBeenCalledWith('key', error);

    now += 2001;
    expect(await cache.getCachedValue('key')).toBeUndefined();
    expect(loader).toHaveBeenCalledTimes(3);
  });

  test('successful background refresh replaces the value', async () => {
    let now = Date.now();
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    const loader = jest.fn().mockResolvedValueOnce('old').mockResolvedValue('new');
    const cache = new InspectableCache({ ttl: 10000, refreshThreshold: 3000, refreshFn: loader });
    expect(await cache.getCachedValue('key')).toBe('old');
    now += 8000;
    const refreshed = cache.refreshed();
    expect(await cache.getCachedValue('key')).toBe('old');
    await refreshed;
    expect(await cache.peek('key')).toBe('new');
  });

  test('concurrent cold reads return undefined on a shared load failure and can retry', async () => {
    const error = new Error('unavailable');
    const loader = jest.fn().mockRejectedValueOnce(error).mockResolvedValue('recovered');
    const onRefreshError = jest.fn();
    const cache = new WrappedMemoryCache({ ttl: 10000, refreshThreshold: 3000, refreshFn: loader, onRefreshError });
    expect(await Promise.all([cache.getCachedValue('key'), cache.getCachedValue('key')])).toEqual([undefined, undefined]);
    expect(loader).toHaveBeenCalledTimes(1);
    expect(onRefreshError).toHaveBeenCalledTimes(1);
    expect(await cache.getCachedValue('key')).toBe('recovered');
  });
});
