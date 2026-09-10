import { createClient } from 'redis';
import { createRedisStore } from '../../src';

describe('createRedisStore', () => {
  it('uses the caller-owned client without connecting or closing it', () => {
    const client = createClient();
    const connect = jest.spyOn(client, 'connect');
    const close = jest.spyOn(client, 'close');
    const store = createRedisStore(client, { prefix: 'app:sess:' });
    expect(store.client).toBe(client);
    expect(store.prefix).toBe('app:sess:');
    expect(client.isOpen).toBe(false);
    expect(connect).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
  });
});
