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
  private readonly generations = new Map<string, number>();
  private nextGeneration = 0;

  constructor(private readonly options: WrappedMemoryCacheOptions) {
    this.cache.on('refresh', ({ key }) => {
      const [logicalKey, generation] = JSON.parse(key) as [string, number];
      if (generation !== this.generations.get(logicalKey)) {
        void this.cache.del(key);
      }
    });
  }

  protected getCacheKey(key: string): string {
    if (!this.generations.has(key)) {
      this.generations.set(key, ++this.nextGeneration);
    }
    return JSON.stringify([key, this.generations.get(key)]);
  }

  async getCachedValue<T>(key: string): Promise<T | undefined> {
    const cacheKey = this.getCacheKey(key);
    const generation = this.generations.get(key);
    const valueFn = async () => {
      try {
        return await this.options.refreshFn(key);
      } catch (e) {
        this.options.onRefreshError?.(key, e);
        throw new CacheLoadError('Cache value loading failed');
      }
    };

    try {
      return await this.cache.wrap(cacheKey, valueFn, this.options.ttl, this.options.refreshThreshold);
    } catch (e) {
      // Background refresh errors are handled by cache-manager without replacing
      // the old value. Preserve undefined on foreground load failure only.
      if (e instanceof CacheLoadError) {
        return undefined;
      }
      throw e;
    } finally {
      if (generation !== this.generations.get(key)) {
        await this.cache.del(cacheKey);
      }
    }
  }

  async delCachedValue(key: string) {
    const generation = this.generations.get(key);
    // Invalidate before awaiting deletion so new reads cannot join an old load.
    this.generations.delete(key);
    if (generation === undefined) {
      return false;
    }
    return await this.cache.del(JSON.stringify([key, generation]));
  }
}
