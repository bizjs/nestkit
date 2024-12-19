import { WrappedMemoryCache } from '../../src';
describe('WrappedMemoryCache', () => {
  test('getCachedValue ok', async () => {
    const errorHandle = jest.fn();
    const cache = new WrappedMemoryCache({
      ttl: 10 * 1000, // 10s
      refreshThreshold: 3 * 1000, // 3s
      refreshFn: (key) => {
        if (key === 'ok') {
          return () => Promise.resolve('ok');
        } else {
          return () => Promise.reject('error');
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
        return () => Promise.reject('error');
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
});
