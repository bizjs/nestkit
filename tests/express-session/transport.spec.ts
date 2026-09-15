import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { ServerResponse } from 'node:http';
import request from 'supertest';
import session, { Cookie, MemoryStore } from '../../src/express-session/index.ts';
import type { HttpSessionRequest, SessionOptions } from '../../src/express-session/index.ts';

const getid: NonNullable<SessionOptions['getid']> = (req) => {
  const value = req.headers['x-session-id'];
  return typeof value === 'string' ? value : undefined;
};

function serverFor(
  options: SessionOptions,
  respond: (req: HttpSessionRequest, res: ServerResponse) => void = (req, res) => {
    const data = req.session!;
    data.count = Number(data.count || 0) + 1;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ id: req.sessionID, count: data.count }));
  },
) {
  const middleware = session(options);
  return createServer((req, res) => {
    middleware(req, res, (error) => {
      if (error) {
        res.statusCode = 500;
        res.end(error instanceof Error ? error.message : String(error));
        return;
      }
      respond(req as HttpSessionRequest, res);
    });
  });
}

async function seed(store: MemoryStore, id: string) {
  await new Promise<void>((resolve, reject) => {
    store.set(id, { cookie: new Cookie({ maxAge: 60_000 }), count: 10 }, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

describe('SID transport', () => {
  it('preserves signed Cookie transport by default', async () => {
    const server = serverFor({ secret: 'test-secret' });
    const first = await request(server).get('/').expect(200);
    const cookies = first.headers['set-cookie'];
    assert.ok(cookies);
    const second = await request(server).get('/').set('Cookie', cookies).expect(200);
    assert.equal(second.body.id, first.body.id);
    assert.equal(second.body.count, 2);
  });

  it('loads a Header SID without a secret or Set-Cookie', async () => {
    const server = serverFor({ cookie: false, getid });
    const first = await request(server).get('/').expect(200);
    assert.equal(first.headers['set-cookie'], undefined);
    const second = await request(server).get('/').set('x-session-id', first.body.id).expect(200);
    assert.equal(second.body.id, first.body.id);
    assert.equal(second.body.count, 2);
    assert.equal(second.headers['set-cookie'], undefined);
  });

  it('ignores an otherwise valid session Cookie when disabled', async () => {
    const store = new MemoryStore();
    const cookieServer = serverFor({ store, secret: 'test-secret' });
    const first = await request(cookieServer).get('/').expect(200);
    const headerServer = serverFor({ store, cookie: false, getid });
    const second = await request(headerServer).get('/').set('Cookie', first.headers['set-cookie']).expect(200);
    assert.notEqual(second.body.id, first.body.id);
    assert.equal(second.body.count, 1);
    assert.equal(second.headers['set-cookie'], undefined);
  });

  it('uses a custom reader exclusively even with Cookie transport enabled', async () => {
    const store = new MemoryStore();
    await seed(store, 'header-session');
    const server = serverFor({ store, secret: 'test-secret', getid });
    const first = await request(server).get('/').expect(200);
    const selected = await request(server)
      .get('/')
      .set('Cookie', first.headers['set-cookie'])
      .set('x-session-id', 'header-session')
      .expect(200);
    assert.equal(selected.body.id, 'header-session');
    assert.equal(selected.body.count, 11);
    const missing = await request(server).get('/').set('Cookie', first.headers['set-cookie']).expect(200);
    assert.notEqual(missing.body.id, first.body.id);
    assert.equal(missing.body.count, 1);
  });

  it('generates a fresh ID for an unknown client SID', async () => {
    const server = serverFor({ cookie: false, getid });
    const response = await request(server).get('/').set('x-session-id', 'unknown-id').expect(200);
    assert.notEqual(response.body.id, 'unknown-id');
    assert.equal(response.body.count, 1);
  });

  it('passes reader errors to next without invoking the route or writing cookies', async () => {
    let called = false;
    const server = serverFor(
      {
        cookie: false,
        getid: () => {
          throw new Error('invalid SID header');
        },
      },
      () => {
        called = true;
      },
    );
    const response = await request(server).get('/').expect(500, 'invalid SID header');
    assert.equal(called, false);
    assert.equal(response.headers['set-cookie'], undefined);
  });

  it('keeps Store touch and expiry metadata when Cookie transport is disabled', async () => {
    const store = new MemoryStore();
    await seed(store, 'existing-session');
    let touches = 0;
    const touch = store.touch.bind(store);
    store.touch = (id, data, callback) => {
      touches++;
      assert.ok(data.cookie.expires instanceof Date);
      touch(id, data, callback);
    };
    const server = serverFor({ cookie: false, getid, store, resave: false, saveUninitialized: false }, (req, res) => {
      res.end(req.sessionID);
    });
    const response = await request(server)
      .get('/other/path')
      .set('x-session-id', 'existing-session')
      .expect(200, 'existing-session');
    assert.equal(touches, 1);
    assert.equal(response.headers['set-cookie'], undefined);
  });

  it('does not remove unrelated application cookies', async () => {
    const server = serverFor({ cookie: false, getid }, (req, res) => {
      req.session!.active = true;
      res.setHeader('Set-Cookie', 'preference=dark; Path=/');
      res.end('ok');
    });
    const response = await request(server).get('/').expect(200, 'ok');
    assert.deepEqual(response.headers['set-cookie'], ['preference=dark; Path=/']);
  });
});
