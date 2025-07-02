import { createCache } from 'cache-manager';

export type WrappedMemoryCacheOptions = {
  ttl: number;
  refreshThreshold: number;
  refreshFn: (key: string) => () => Promise<any>;
  onRefreshError?: (key: string, error: any) => void;
};

export class WrappedMemoryCache {
  protected readonly cache = createCache();
  constructor(private readonly options: WrappedMemoryCacheOptions) {}

  async getCachedValue<T>(key: string): Promise<T | undefined> {
    const valueFn = async () => {
      try {
        return await this.options.refreshFn(key)();
      } catch (e) {
        this.options.onRefreshError?.(key, e);
      }
    };

    const value = await this.cache.wrap(key, valueFn, this.options.ttl, this.options.refreshThreshold);
    return value;
  }

  async delCachedValue(key: string) {
    await this.cache.del(key);
  }
}
