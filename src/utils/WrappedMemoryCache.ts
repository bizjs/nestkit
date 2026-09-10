import { createCache } from 'cache-manager';

class CacheLoadError extends Error {}

export type WrappedMemoryCacheOptions = {
  ttl: number;
  refreshThreshold: number;
  refreshFn: (key: string) => Promise<any>;
  onRefreshError?: (key: string, error: any) => void;
};

export class WrappedMemoryCache {
  protected readonly cache = createCache();
  constructor(private readonly options: WrappedMemoryCacheOptions) {}

  async getCachedValue<T>(key: string): Promise<T | undefined> {
    const valueFn = async () => {
      try {
        return await this.options.refreshFn(key);
      } catch (e) {
        this.options.onRefreshError?.(key, e);
        throw new CacheLoadError('Cache value loading failed');
      }
    };

    try {
      return await this.cache.wrap(key, valueFn, this.options.ttl, this.options.refreshThreshold);
    } catch (e) {
      // Background refresh errors are handled by cache-manager without replacing
      // the old value. Preserve undefined on foreground load failure only.
      if (e instanceof CacheLoadError) {
        return undefined;
      }
      throw e;
    }
  }

  async delCachedValue(key: string) {
    return await this.cache.del(key);
  }
}
