import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServer } from 'node:http';
import request from 'supertest';
import { expressSession } from '../../src';
import type { HttpSessionRequest, SessionOptions } from '../../src';

const minute = 60_000;
const ttl = 30 * minute;
let now: number;

beforeEach(() => {
  now = Date.now();
  vi.spyOn(Date, 'now').mockImplementation(() => now);
});

afterEach(() => vi.restoreAllMocks());

function setup(options: Partial<SessionOptions> = {}) {
  const store = new expressSession.MemoryStore();
  const set = vi.spyOn(store, 'set');
  const touch = vi.spyOn(store, 'touch');
  const middleware = expressSession({
    cookie: false,
    getid: (req) => req.headers['x-session-id'] as string | undefined,
    resave: false,
    saveUninitialized: false,
    touchInterval: 5 * minute,
    ...options,
    store,
  });
  const server = createServer((request, res) => {
    const req = request as HttpSessionRequest;
    middleware(req, res, (error) => {
      if (error) {
        res.statusCode = 500;
        res.end(String(error));
        return;
      }
      const session = req.session!;
      if (req.url === '/init') {
        session.userId = 'user-1';
        session.cookie.maxAge = ttl;
      }
      if (req.url === '/write') session.userId = 'user-2';
      if (req.url === '/save') {
        session.save((error) => {
          res.statusCode = error ? 500 : 200;
          res.end(req.sessionID);
        });
        return;
      }
      res.end(req.sessionID);
    });
  });
  const expires = (id: string) => Date.parse(JSON.parse(store.sessions[id]).cookie.expires);
  return { server, store, set, touch, expires };
}

describe('touchInterval', () => {
  it('skips reads within the interval and renews at the boundary', async () => {
    const { server, set, touch, expires } = setup();
    const start = now;
    const { text: id } = await request(server).get('/init').expect(200);
    now += 5 * minute - 1;
    await request(server).get('/').set('x-session-id', id).expect(200, id);
    expect(set).toHaveBeenCalledTimes(1);
    expect(touch).not.toHaveBeenCalled();
    expect(expires(id)).toBe(start + ttl);

    now++;
    await request(server).get('/').set('x-session-id', id).expect(200, id);
    expect(touch).toHaveBeenCalledTimes(1);
    expect(expires(id)).toBe(now + ttl);
    now++;
    await request(server).get('/').set('x-session-id', id).expect(200, id);
    expect(touch).toHaveBeenCalledTimes(1);
  });

  it('immediately saves changes and starts the interval from that save', async () => {
    const { server, store, set, touch, expires } = setup();
    const { text: id } = await request(server).get('/init').expect(200);
    now += 2 * minute;
    await request(server).get('/write').set('x-session-id', id).expect(200, id);
    expect(set).toHaveBeenCalledTimes(2);
    expect(JSON.parse(store.sessions[id]).userId).toBe('user-2');
    expect(expires(id)).toBe(now + ttl);
    now += 3 * minute;
    await request(server).get('/').set('x-session-id', id).expect(200, id);
    expect(touch).not.toHaveBeenCalled();
    now += 2 * minute;
    await request(server).get('/').set('x-session-id', id).expect(200, id);
    expect(touch).toHaveBeenCalledTimes(1);
  });

  it('does not throttle explicit saves or issue a redundant touch afterwards', async () => {
    const { server, set, touch, expires } = setup();
    const { text: id } = await request(server).get('/init').expect(200);
    now += minute;
    await request(server).get('/save').set('x-session-id', id).expect(200, id);
    expect(set).toHaveBeenCalledTimes(2);
    expect(touch).not.toHaveBeenCalled();
    expect(expires(id)).toBe(now + ttl);
  });

  it('keeps the original per-request renewal when the interval is omitted', async () => {
    const { server, touch, expires } = setup({ touchInterval: undefined });
    const { text: id } = await request(server).get('/init').expect(200);
    for (let i = 0; i < 2; i++) {
      now += minute;
      await request(server).get('/').set('x-session-id', id).expect(200, id);
      expect(expires(id)).toBe(now + ttl);
    }
    expect(touch).toHaveBeenCalledTimes(2);
  });

  it('does not override resave: true', async () => {
    const { server, set, touch, expires } = setup({ resave: true });
    const { text: id } = await request(server).get('/init').expect(200);
    now += minute;
    await request(server).get('/').set('x-session-id', id).expect(200, id);
    expect(set).toHaveBeenCalledTimes(2);
    expect(touch).not.toHaveBeenCalled();
    expect(expires(id)).toBe(now + ttl);
  });

  it('keeps rolling Cookie expiry aligned with the throttled Store expiry', async () => {
    const { server, touch, expires } = setup({ cookie: { maxAge: ttl }, getid: undefined, rolling: true });
    const first = await request(server).get('/init').expect(200);
    const cookieExpiry = (res: request.Response) => {
      const header = res.headers['set-cookie'][0];
      return Date.parse(/Expires=([^;]+)/i.exec(header)![1]);
    };
    now += minute;
    const second = await request(server).get('/').set('Cookie', first.headers['set-cookie']).expect(200, first.text);
    expect(cookieExpiry(second)).toBe(cookieExpiry(first));
    expect(touch).not.toHaveBeenCalled();
    now += 4 * minute;
    const third = await request(server).get('/').set('Cookie', second.headers['set-cookie']).expect(200, first.text);
    expect(touch).toHaveBeenCalledTimes(1);
    expect(cookieExpiry(third)).toBe(Math.floor(expires(first.text) / 1000) * 1000);
  });

  it('does not revive an expired session', async () => {
    const { server, touch } = setup();
    const { text: id } = await request(server).get('/init').expect(200);
    now += ttl;
    const response = await request(server).get('/').set('x-session-id', id).expect(200);
    expect(response.text).not.toBe(id);
    expect(touch).not.toHaveBeenCalled();
  });
});
