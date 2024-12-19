import { WrappedMemoryCache } from '../../src';
describe('WrappedMemoryCache', () => {
  test('getCachedValue ok', async () => {
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
        console.log('onRefreshError', key, error);
      }
    });

    let val = await cache.getCachedValue('ok');
    expect(val).toBe('ok');

    val = await cache.getCachedValue('error');
    expect(val).toBeUndefined();
  });
});
