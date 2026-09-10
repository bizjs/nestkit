import { RedisStore } from 'connect-redis';
import { createClient, createCluster } from 'redis';

export function createRedisStore(
  client: ReturnType<typeof createClient> | ReturnType<typeof createCluster>,
  args: { prefix: string },
): RedisStore {
  return new RedisStore({ client, prefix: args.prefix });
}
