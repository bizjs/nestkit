import { describe, it, beforeAll } from 'vitest';

import { once } from 'node:events';
import assert from 'node:assert';
import cookieParser from 'cookie-parser';
import express from 'express';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import request from 'supertest';
import { expressSession as session } from '../../src';
import type { SessionOptions, SessionMiddleware } from '../../src';
import type { Store, SessionData } from '../../src/express-session';

// Fixtures deliberately exercise missing, malformed and dynamically added session fields.
type TestRequest = http.IncomingMessage & { [key: string]: any };
type TestResponse = http.ServerResponse & { _header?: string | null };
type Handler = (req: TestRequest, res: TestResponse) => void;
type TestOptions = Record<string, any>;
type ResponseAssertion = (res: request.Response) => void;

import SmartStore from './support/smart-store.ts';
import SyncStore from './support/sync-store.ts';
import * as utils from './support/utils.ts';
import { Cookie } from '../../src/express-session';
let min = 60 * 1000;

describe('session()', function () {
  it('should export constructors', function () {
    assert.strictEqual(typeof session.Session, 'function');
    assert.strictEqual(typeof session.Store, 'function');
    assert.strictEqual(typeof session.MemoryStore, 'function');
  });

  it('should do nothing if req.session exists', function () {
    return new Promise<void>((resolve, reject) => {
      const done = (error?: unknown) => (error ? reject(error) : resolve());

      function setup(req: TestRequest) {
        req.session = {};
      }

      request(createServer(setup)).get('/').expect(shouldNotHaveHeader('Set-Cookie')).expect(200, done);
    });
  });

  it('should create a new session', function () {
    return new Promise<void>((resolve, reject) => {
      const done = (error?: unknown) => (error ? reject(error) : resolve());

      let store = new session.MemoryStore();
      let server: http.Server = createServer({ store: store }, function (req: TestRequest, res: TestResponse) {
        req.session.active = true;
        res.end('session active');
      });

      request(server)
        .get('/')
        .expect(shouldSetCookie('connect.sid'))
        .expect(200, 'session active', function (err, res) {
          if (err) return done(err);
          store.length(function (err, len) {
            if (err) return done(err);
            assert.strictEqual(len, 1);
            done();
          });
        });
    });
  });

  it('should load session from cookie sid', function () {
    return new Promise<void>((resolve, reject) => {
      const done = (error?: unknown) => (error ? reject(error) : resolve());

      let count = 0;
      let server: http.Server = createServer(null, function (req: TestRequest, res: TestResponse) {
        req.session.num = req.session.num || ++count;
        res.end('session ' + req.session.num);
      });

      request(server)
        .get('/')
        .expect(shouldSetCookie('connect.sid'))
        .expect(200, 'session 1', function (err, res) {
          if (err) return done(err);
          request(server).get('/').set('Cookie', cookie(res)).expect(200, 'session 1', done);
        });
    });
  });

  it('should pass session fetch error', function () {
    return new Promise<void>((resolve, reject) => {
      const done = (error?: unknown) => (error ? reject(error) : resolve());

      let store = new session.MemoryStore();
      let server: http.Server = createServer({ store: store }, function (req: TestRequest, res: TestResponse) {
        res.end('hello, world');
      });

      store.get = function destroy(sid, callback) {
        callback(new Error('boom!'));
      };

      request(server)
        .get('/')
        .expect(shouldSetCookie('connect.sid'))
        .expect(200, 'hello, world', function (err, res) {
          if (err) return done(err);
          request(server).get('/').set('Cookie', cookie(res)).expect(500, 'boom!', done);
        });
    });
  });

  it('should treat ENOENT session fetch error as not found', function () {
    return new Promise<void>((resolve, reject) => {
      const done = (error?: unknown) => (error ? reject(error) : resolve());

      let count = 0;
      let store = new session.MemoryStore();
      let server: http.Server = createServer({ store: store }, function (req: TestRequest, res: TestResponse) {
        req.session.num = req.session.num || ++count;
        res.end('session ' + req.session.num);
      });

      store.get = function destroy(sid, callback) {
        let err: NodeJS.ErrnoException = new Error('boom!');
        err.code = 'ENOENT';
        callback(err);
      };

      request(server)
        .get('/')
        .expect(shouldSetCookie('connect.sid'))
        .expect(200, 'session 1', function (err, res) {
          if (err) return done(err);
          request(server).get('/').set('Cookie', cookie(res)).expect(200, 'session 2', done);
        });
    });
  });

  it('should create multiple sessions', async function () {
    let count = 0;
    let store = new session.MemoryStore();
    let server: http.Server = createServer({ store: store }, function (req: TestRequest, res: TestResponse) {
      let isnew = req.session.num === undefined;
      req.session.num = req.session.num || ++count;
      res.end('session ' + (isnew ? 'created' : 'updated'));
    });

    await Promise.all([
      request(server).get('/').expect(200, 'session created'),
      request(server).get('/').expect(200, 'session created'),
    ]);
    const sessions = await new Promise<Record<string, SessionData>>((resolve, reject) => {
      store.all((error, data) => {
        if (error) reject(error);
        else resolve(data);
      });
    });
    assert.equal(Object.keys(sessions).length, 2);
  });

  it('should handle empty req.url', function () {
    return new Promise<void>((resolve, reject) => {
      const done = (error?: unknown) => (error ? reject(error) : resolve());

      function setup(req: TestRequest) {
        req.url = '';
      }

      request(createServer(setup)).get('/').expect(shouldSetCookie('connect.sid')).expect(200, done);
    });
  });

  it('should handle multiple res.end calls', function () {
    return new Promise<void>((resolve, reject) => {
      const done = (error?: unknown) => (error ? reject(error) : resolve());

      let server: http.Server = createServer(null, function (req: TestRequest, res: TestResponse) {
        res.setHeader('Content-Type', 'text/plain');
        res.end('Hello, world!');
        res.end();
      });

      request(server).get('/').expect('Content-Type', 'text/plain').expect(200, 'Hello, world!', done);
    });
  });

  it('should handle res.end(null) calls', function () {
    return new Promise<void>((resolve, reject) => {
      const done = (error?: unknown) => (error ? reject(error) : resolve());

      let server: http.Server = createServer(null, function (req: TestRequest, res: TestResponse) {
        res.end(null);
      });

      request(server).get('/').expect(200, '', done);
    });
  });

  it('should handle reserved properties in storage', function () {
    return new Promise<void>((resolve, reject) => {
      const done = (error?: unknown) => (error ? reject(error) : resolve());

      let count = 0;
      let sid;
      let store = new session.MemoryStore();
      let server: http.Server = createServer({ store: store }, function (req: TestRequest, res: TestResponse) {
        sid = req.session.id;
        req.session.num = req.session.num || ++count;
        res.end('session saved');
      });

      request(server)
        .get('/')
        .expect(200, 'session saved', function (err, res) {
          if (err) return done(err);
          store.get(sid, function (err, sess) {
            if (err) return done(err);
            // save is reserved
            sess.save = 'nope';
            store.set(sid, sess, function (err) {
              if (err) return done(err);
              request(server).get('/').set('Cookie', cookie(res)).expect(200, 'session saved', done);
            });
          });
        });
    });
  });

  it('should only have session data enumerable (and cookie)', function () {
    return new Promise<void>((resolve, reject) => {
      const done = (error?: unknown) => (error ? reject(error) : resolve());

      let server: http.Server = createServer(null, function (req: TestRequest, res: TestResponse) {
        req.session.test1 = 1;
        req.session.test2 = 'b';
        res.end(Object.keys(req.session).sort().join(','));
      });

      request(server).get('/').expect(200, 'cookie,test1,test2', done);
    });
  });

  it('should not save with bogus req.sessionID', function () {
    return new Promise<void>((resolve, reject) => {
      const done = (error?: unknown) => (error ? reject(error) : resolve());

      let store = new session.MemoryStore();
      let server: http.Server = createServer({ store: store }, function (req: TestRequest, res: TestResponse) {
        req.sessionID = function () {};
        req.session.test1 = 1;
        req.session.test2 = 'b';
        res.end();
      });

      request(server)
        .get('/')
        .expect(shouldNotHaveHeader('Set-Cookie'))
        .expect(200, function (err) {
          if (err) return done(err);
          store.length(function (err, length) {
            if (err) return done(err);
            assert.strictEqual(length, 0);
            done();
          });
        });
    });
  });

  it('should update cookie expiration when slow write', function () {
    return new Promise<void>((resolve, reject) => {
      const done = (error?: unknown) => (error ? reject(error) : resolve());

      let server: http.Server = createServer({ rolling: true }, function (req: TestRequest, res: TestResponse) {
        req.session.user = 'bob';
        res.write('hello, ');
        setTimeout(function () {
          res.end('world!');
        }, 200);
      });

      request(server)
        .get('/')
        .expect(shouldSetCookie('connect.sid'))
        .expect(200, function (err, res) {
          if (err) return done(err);
          let originalExpires = expires(res);
          setTimeout(
            function () {
              request(server)
                .get('/')
                .set('Cookie', cookie(res))
                .expect(shouldSetCookie('connect.sid'))
                .expect(function (res) {
                  assert.notStrictEqual(originalExpires, expires(res));
                })
                .expect(200, done);
            },
            1000 - (Date.now() % 1000) + 200,
          );
        });
    });
  });

  describe('when response ended', function () {
    it('should have saved session', function () {
      return new Promise<void>((resolve, reject) => {
        const done = (error?: unknown) => (error ? reject(error) : resolve());

        let store = new session.MemoryStore();
        let server: http.Server = createServer({ store: store }, function (req: TestRequest, res: TestResponse) {
          req.session.hit = true;
          res.end('session saved');
        });

        request(server)
          .get('/')
          .expect(200)
          .expect(shouldSetSessionInStore(store, 200))
          .expect('session saved')
          .end(done);
      });
    });

    it('should have saved session even with empty response', function () {
      return new Promise<void>((resolve, reject) => {
        const done = (error?: unknown) => (error ? reject(error) : resolve());

        let store = new session.MemoryStore();
        let server: http.Server = createServer({ store: store }, function (req: TestRequest, res: TestResponse) {
          req.session.hit = true;
          res.setHeader('Content-Length', '0');
          res.end();
        });

        request(server).get('/').expect(200).expect(shouldSetSessionInStore(store, 200)).end(done);
      });
    });

    it('should have saved session even with multi-write', function () {
      return new Promise<void>((resolve, reject) => {
        const done = (error?: unknown) => (error ? reject(error) : resolve());

        let store = new session.MemoryStore();
        let server: http.Server = createServer({ store: store }, function (req: TestRequest, res: TestResponse) {
          req.session.hit = true;
          res.setHeader('Content-Length', '12');
          res.write('hello, ');
          res.end('world');
        });

        request(server)
          .get('/')
          .expect(200)
          .expect(shouldSetSessionInStore(store, 200))
          .expect('hello, world')
          .end(done);
      });
    });

    it('should have saved session even with non-chunked response', function () {
      return new Promise<void>((resolve, reject) => {
        const done = (error?: unknown) => (error ? reject(error) : resolve());

        let store = new session.MemoryStore();
        let server: http.Server = createServer({ store: store }, function (req: TestRequest, res: TestResponse) {
          req.session.hit = true;
          res.setHeader('Content-Length', '13');
          res.end('session saved');
        });

        request(server)
          .get('/')
          .expect(200)
          .expect(shouldSetSessionInStore(store, 200))
          .expect('session saved')
          .end(done);
      });
    });

    it('should have saved session with updated cookie expiration', function () {
      return new Promise<void>((resolve, reject) => {
        const done = (error?: unknown) => (error ? reject(error) : resolve());

        let store = new session.MemoryStore();
        let server: http.Server = createServer(
          { cookie: { maxAge: min }, store: store },
          function (req: TestRequest, res: TestResponse) {
            req.session.user = 'bob';
            res.end(req.session.id);
          },
        );

        request(server)
          .get('/')
          .expect(shouldSetCookie('connect.sid'))
          .expect(200, function (err, res) {
            if (err) return done(err);
            let id = res.text;
            store.get(id, function (err, sess) {
              if (err) return done(err);
              assert.ok(sess, 'session saved to store');
              let exp = new Date(sess!.cookie.expires as string);
              assert.strictEqual(exp.toUTCString(), expires(res));
              setTimeout(
                function () {
                  request(server)
                    .get('/')
                    .set('Cookie', cookie(res))
                    .expect(200, function (err, res) {
                      if (err) return done(err);
                      store.get(id, function (err, sess) {
                        if (err) return done(err);
                        assert.strictEqual(res.text, id);
                        assert.ok(sess, 'session still in store');
                        assert.notStrictEqual(
                          new Date(sess!.cookie.expires as string).toUTCString(),
                          exp.toUTCString(),
                          'session cookie expiration updated',
                        );
                        done();
                      });
                    });
                },
                1000 - (Date.now() % 1000) + 200,
              );
            });
          });
      });
    });
  });

  describe('when sid not in store', function () {
    it('should create a new session', function () {
      return new Promise<void>((resolve, reject) => {
        const done = (error?: unknown) => (error ? reject(error) : resolve());

        let count = 0;
        let store = new session.MemoryStore();
        let server: http.Server = createServer({ store: store }, function (req: TestRequest, res: TestResponse) {
          req.session.num = req.session.num || ++count;
          res.end('session ' + req.session.num);
        });

        request(server)
          .get('/')
          .expect(shouldSetCookie('connect.sid'))
          .expect(200, 'session 1', function (err, res) {
            if (err) return done(err);
            store.clear(function (err) {
              if (err) return done(err);
              request(server).get('/').set('Cookie', cookie(res)).expect(200, 'session 2', done);
            });
          });
      });
    });

    it('should have a new sid', function () {
      return new Promise<void>((resolve, reject) => {
        const done = (error?: unknown) => (error ? reject(error) : resolve());

        let count = 0;
        let store = new session.MemoryStore();
        let server: http.Server = createServer({ store: store }, function (req: TestRequest, res: TestResponse) {
          req.session.num = req.session.num || ++count;
          res.end('session ' + req.session.num);
        });

        request(server)
          .get('/')
          .expect(shouldSetCookie('connect.sid'))
          .expect(200, 'session 1', function (err, res) {
            if (err) return done(err);
            store.clear(function (err) {
              if (err) return done(err);
              request(server)
                .get('/')
                .set('Cookie', cookie(res))
                .expect(shouldSetCookie('connect.sid'))
                .expect(shouldSetCookieToDifferentSessionId(sid(res)))
                .expect(200, 'session 2', done);
            });
          });
      });
    });
  });

  describe('when the client supplies an unknown sid', function () {
    it('should generate new session', function () {
      return new Promise<void>((resolve, reject) => {
        const done = (error?: unknown) => (error ? reject(error) : resolve());

        let store = new session.MemoryStore();
        let server: http.Server = createServer(
          { store: store, name: 'sessid' },
          function (req: TestRequest, res: TestResponse) {
            let isnew = req.session.active === undefined;
            req.session.active = true;
            res.end('session ' + (isnew ? 'created' : 'read'));
          },
        );

        request(server)
          .get('/')
          .expect(shouldSetCookie('sessid'))
          .expect(200, 'session created', function (err, res) {
            if (err) return done(err);
            let val = sid(res) + '-unknown';
            assert.ok(val);
            request(server)
              .get('/')
              .set('Cookie', 'sessid=' + val)
              .expect(shouldSetCookie('sessid'))
              .expect(shouldSetCookieToDifferentSessionId(val))
              .expect(200, 'session created', done);
          });
      });
    });

    it('should replace an unknown cookie with a fresh session', function () {
      return new Promise<void>((resolve, reject) => {
        const done = (error?: unknown) => (error ? reject(error) : resolve());

        let store = new session.MemoryStore();
        let server: http.Server = createServer(
          { store: store, name: 'sessid' },
          function (req: TestRequest, res: TestResponse) {
            let isnew = req.session.active === undefined;
            req.session.active = true;
            res.end('session ' + (isnew ? 'created' : 'read'));
          },
        );

        request(server)
          .get('/')
          .expect(shouldSetCookie('sessid'))
          .expect(200, 'session created', function (err, res) {
            if (err) return done(err);
            let val = 'sessid=' + sid(res) + '-unknown';

            assert.ok(val);
            request(server)
              .get('/')
              .set('Cookie', val)
              .expect(shouldSetCookie('sessid'))
              .expect(200, 'session created', done);
          });
      });
    });
  });

  describe('when session expired in store', function () {
    it('should create a new session', function () {
      return new Promise<void>((resolve, reject) => {
        const done = (error?: unknown) => (error ? reject(error) : resolve());

        let count = 0;
        let store = new session.MemoryStore();
        let server: http.Server = createServer(
          { store: store, cookie: { maxAge: 5 } },
          function (req: TestRequest, res: TestResponse) {
            req.session.num = req.session.num || ++count;
            res.end('session ' + req.session.num);
          },
        );

        request(server)
          .get('/')
          .expect(shouldSetCookie('connect.sid'))
          .expect(200, 'session 1', function (err, res) {
            if (err) return done(err);
            setTimeout(function () {
              request(server)
                .get('/')
                .set('Cookie', cookie(res))
                .expect(shouldSetCookie('connect.sid'))
                .expect(200, 'session 2', done);
            }, 20);
          });
      });
    });

    it('should have a new sid', function () {
      return new Promise<void>((resolve, reject) => {
        const done = (error?: unknown) => (error ? reject(error) : resolve());

        let count = 0;
        let store = new session.MemoryStore();
        let server: http.Server = createServer(
          { store: store, cookie: { maxAge: 5 } },
          function (req: TestRequest, res: TestResponse) {
            req.session.num = req.session.num || ++count;
            res.end('session ' + req.session.num);
          },
        );

        request(server)
          .get('/')
          .expect(shouldSetCookie('connect.sid'))
          .expect(200, 'session 1', function (err, res) {
            if (err) return done(err);
            setTimeout(function () {
              request(server)
                .get('/')
                .set('Cookie', cookie(res))
                .expect(shouldSetCookie('connect.sid'))
                .expect(shouldSetCookieToDifferentSessionId(sid(res)))
                .expect(200, 'session 2', done);
            }, 15);
          });
      });
    });

    it('should not exist in store', function () {
      return new Promise<void>((resolve, reject) => {
        const done = (error?: unknown) => (error ? reject(error) : resolve());

        let count = 0;
        let store = new session.MemoryStore();
        let server: http.Server = createServer(
          { store: store, cookie: { maxAge: 5 } },
          function (req: TestRequest, res: TestResponse) {
            req.session.num = req.session.num || ++count;
            res.end('session ' + req.session.num);
          },
        );

        request(server)
          .get('/')
          .expect(shouldSetCookie('connect.sid'))
          .expect(200, 'session 1', function (err, res) {
            if (err) return done(err);
            setTimeout(function () {
              store.all(function (err, sess) {
                if (err) return done(err);
                assert.strictEqual(Object.keys(sess).length, 0);
                done();
              });
            }, 10);
          });
      });
    });
  });

  describe('when session without cookie property in store', function () {
    it('should pass error from inflate', function () {
      return new Promise<void>((resolve, reject) => {
        const done = (error?: unknown) => (error ? reject(error) : resolve());

        let count = 0;
        let store = new session.MemoryStore();
        let server: http.Server = createServer({ store: store }, function (req: TestRequest, res: TestResponse) {
          req.session.num = req.session.num || ++count;
          res.end('session ' + req.session.num);
        });

        request(server)
          .get('/')
          .expect(shouldSetCookie('connect.sid'))
          .expect(200, 'session 1', function (err, res) {
            if (err) return done(err);
            store.set(sid(res), { foo: 'bar' } as unknown as SessionData, function (err) {
              if (err) return done(err);
              request(server)
                .get('/')
                .set('Cookie', cookie(res))
                .expect(500, /Cannot read prop/, done);
            });
          });
      });
    });
  });

  describe('proxy option', function () {
    describe('when enabled', function () {
      let server: http.Server;
      beforeAll(function () {
        server = createServer({
          proxy: true,
          cookie: { secure: true, maxAge: 5 },
        });
      });

      it('should trust X-Forwarded-Proto when string', function () {
        return new Promise<void>((resolve, reject) => {
          const done = (error?: unknown) => (error ? reject(error) : resolve());

          request(server)
            .get('/')
            .set('X-Forwarded-Proto', 'https')
            .expect(shouldSetCookie('connect.sid'))
            .expect(200, done);
        });
      });

      it('should trust X-Forwarded-Proto when comma-separated list', function () {
        return new Promise<void>((resolve, reject) => {
          const done = (error?: unknown) => (error ? reject(error) : resolve());

          request(server)
            .get('/')
            .set('X-Forwarded-Proto', 'https,http')
            .expect(shouldSetCookie('connect.sid'))
            .expect(200, done);
        });
      });

      it('should work when no header', function () {
        return new Promise<void>((resolve, reject) => {
          const done = (error?: unknown) => (error ? reject(error) : resolve());

          request(server).get('/').expect(shouldNotHaveHeader('Set-Cookie')).expect(200, done);
        });
      });
    });

    describe('when disabled', function () {
      const suiteState = {} as { server: http.Server; cookie: string };

      beforeAll(function () {
        function setup(req: TestRequest) {
          req.secure = req.headers['x-secure'] ? JSON.parse(req.headers['x-secure'] as string) : undefined;
        }

        function respond(req: TestRequest, res: TestResponse) {
          res.end(String(req.secure));
        }

        suiteState.server = createServer(setup, { proxy: false, cookie: { secure: true } }, respond);
      });

      it('should not trust X-Forwarded-Proto', function () {
        return new Promise<void>((resolve, reject) => {
          const done = (error?: unknown) => (error ? reject(error) : resolve());

          request(suiteState.server)
            .get('/')
            .set('X-Forwarded-Proto', 'https')
            .expect(shouldNotHaveHeader('Set-Cookie'))
            .expect(200, done);
        });
      });

      it('should ignore req.secure', function () {
        return new Promise<void>((resolve, reject) => {
          const done = (error?: unknown) => (error ? reject(error) : resolve());

          request(suiteState.server)
            .get('/')
            .set('X-Forwarded-Proto', 'https')
            .set('X-Secure', 'true')
            .expect(shouldNotHaveHeader('Set-Cookie'))
            .expect(200, 'true', done);
        });
      });
    });

    describe('when unspecified', function () {
      const suiteState = {} as { server: http.Server; cookie: string };

      beforeAll(function () {
        function setup(req: TestRequest) {
          req.secure = req.headers['x-secure'] ? JSON.parse(req.headers['x-secure'] as string) : undefined;
        }

        function respond(req: TestRequest, res: TestResponse) {
          res.end(String(req.secure));
        }

        suiteState.server = createServer(setup, { cookie: { secure: true } }, respond);
      });

      it('should not trust X-Forwarded-Proto', function () {
        return new Promise<void>((resolve, reject) => {
          const done = (error?: unknown) => (error ? reject(error) : resolve());

          request(suiteState.server)
            .get('/')
            .set('X-Forwarded-Proto', 'https')
            .expect(shouldNotHaveHeader('Set-Cookie'))
            .expect(200, done);
        });
      });

      it('should use req.secure', function () {
        return new Promise<void>((resolve, reject) => {
          const done = (error?: unknown) => (error ? reject(error) : resolve());

          request(suiteState.server)
            .get('/')
            .set('X-Forwarded-Proto', 'https')
            .set('X-Secure', 'true')
            .expect(shouldSetCookie('connect.sid'))
            .expect(200, 'true', done);
        });
      });
    });
  });

  describe('cookie option', function () {
    describe('when "path" set to "/foo/bar"', function () {
      const suiteState = {} as { server: http.Server; cookie: string };

      beforeAll(function () {
        suiteState.server = createServer({ cookie: { path: '/foo/bar' } });
      });

      it('should not set cookie for "/" request', function () {
        return new Promise<void>((resolve, reject) => {
          const done = (error?: unknown) => (error ? reject(error) : resolve());

          request(suiteState.server).get('/').expect(shouldNotHaveHeader('Set-Cookie')).expect(200, done);
        });
      });

      it('should not set cookie for "http://foo/bar" request', function () {
        return new Promise<void>((resolve, reject) => {
          const done = (error?: unknown) => (error ? reject(error) : resolve());

          request(suiteState.server)
            .get('/')
            .set('host', 'http://foo/bar')
            .expect(shouldNotHaveHeader('Set-Cookie'))
            .expect(200, done);
        });
      });

      it('should set cookie for "/foo/bar" request', function () {
        return new Promise<void>((resolve, reject) => {
          const done = (error?: unknown) => (error ? reject(error) : resolve());

          request(suiteState.server).get('/foo/bar/baz').expect(shouldSetCookie('connect.sid')).expect(200, done);
        });
      });

      it('should set cookie for "/foo/bar/baz" request', function () {
        return new Promise<void>((resolve, reject) => {
          const done = (error?: unknown) => (error ? reject(error) : resolve());

          request(suiteState.server).get('/foo/bar/baz').expect(shouldSetCookie('connect.sid')).expect(200, done);
        });
      });

      describe('when mounted at "/foo"', function () {
        const suiteState = {} as { server: http.Server; cookie: string };

        beforeAll(function () {
          suiteState.server = createServer(mountAt('/foo'), {
            cookie: { path: '/foo/bar' },
          });
        });

        it('should set cookie for "/foo/bar" request', function () {
          return new Promise<void>((resolve, reject) => {
            const done = (error?: unknown) => (error ? reject(error) : resolve());

            request(suiteState.server).get('/foo/bar').expect(shouldSetCookie('connect.sid')).expect(200, done);
          });
        });

        it('should not set cookie for "/foo/foo/bar" request', function () {
          return new Promise<void>((resolve, reject) => {
            const done = (error?: unknown) => (error ? reject(error) : resolve());

            request(suiteState.server).get('/foo/foo/bar').expect(shouldNotHaveHeader('Set-Cookie')).expect(200, done);
          });
        });
      });
    });

    describe('when "secure" set to "auto"', function () {
      describe('when "proxy" is "true"', function () {
        const suiteState = {} as { server: http.Server; cookie: string };

        beforeAll(function () {
          suiteState.server = createServer({
            proxy: true,
            cookie: { maxAge: 5, secure: 'auto' },
          });
        });

        it('should set secure when X-Forwarded-Proto is https', function () {
          return new Promise<void>((resolve, reject) => {
            const done = (error?: unknown) => (error ? reject(error) : resolve());

            request(suiteState.server)
              .get('/')
              .set('X-Forwarded-Proto', 'https')
              .expect(shouldSetCookieWithAttribute('connect.sid', 'Secure'))
              .expect(200, done);
          });
        });
      });

      describe('when "proxy" is "false"', function () {
        const suiteState = {} as { server: http.Server; cookie: string };

        beforeAll(function () {
          suiteState.server = createServer({
            proxy: false,
            cookie: { maxAge: 5, secure: 'auto' },
          });
        });

        it('should not set secure when X-Forwarded-Proto is https', function () {
          return new Promise<void>((resolve, reject) => {
            const done = (error?: unknown) => (error ? reject(error) : resolve());

            request(suiteState.server)
              .get('/')
              .set('X-Forwarded-Proto', 'https')
              .expect(shouldSetCookieWithoutAttribute('connect.sid', 'Secure'))
              .expect(200, done);
          });
        });
      });

      describe('when "proxy" is undefined', function () {
        const suiteState = {} as { server: http.Server; cookie: string };

        beforeAll(function () {
          function setup(req: TestRequest) {
            req.secure = JSON.parse(req.headers['x-secure'] as string);
          }

          function respond(req: TestRequest, res: TestResponse) {
            res.end(String(req.secure));
          }

          suiteState.server = createServer(setup, { cookie: { secure: 'auto' } }, respond);
        });

        it('should set secure if req.secure = true', function () {
          return new Promise<void>((resolve, reject) => {
            const done = (error?: unknown) => (error ? reject(error) : resolve());

            request(suiteState.server)
              .get('/')
              .set('X-Secure', 'true')
              .expect(shouldSetCookieWithAttribute('connect.sid', 'Secure'))
              .expect(200, 'true', done);
          });
        });

        it('should not set secure if req.secure = false', function () {
          return new Promise<void>((resolve, reject) => {
            const done = (error?: unknown) => (error ? reject(error) : resolve());

            request(suiteState.server)
              .get('/')
              .set('X-Secure', 'false')
              .expect(shouldSetCookieWithoutAttribute('connect.sid', 'Secure'))
              .expect(200, 'false', done);
          });
        });
      });
    });

    describe('when "cookie" is a function', function () {
      it('should call custom function and apply cookie options', function () {
        return new Promise<void>((resolve, reject) => {
          const done = (error?: unknown) => (error ? reject(error) : resolve());

          let cookieCallbackCalled = false;
          let cookieCallback = function () {
            cookieCallbackCalled = true;
            return { path: '/test', httpOnly: true, secure: false };
          };
          let server: http.Server = createServer({ cookie: cookieCallback });
          request(server)
            .get('/test')
            .expect(shouldSetCookieWithAttributeAndValue('connect.sid', 'Path', '/test'))
            .expect(shouldSetCookieWithAttribute('connect.sid', 'HttpOnly'))
            .expect(shouldSetCookieWithoutAttribute('connect.sid', 'Secure'))
            .expect(200, function (err) {
              if (err) return done(err);
              assert.strictEqual(cookieCallbackCalled, true, 'should have called cookie callback');
              done();
            });
        });
      });

      it('should provide req argument', function () {
        return new Promise<void>((resolve, reject) => {
          const done = (error?: unknown) => (error ? reject(error) : resolve());

          let _path = '/test';
          let cookieCallbackCalled = false;
          let cookieCallback = function (req: TestRequest) {
            cookieCallbackCalled = true;
            return { path: req.url, httpOnly: true, secure: false };
          };
          let server: http.Server = createServer({ cookie: cookieCallback });
          request(server)
            .get(_path)
            .expect(shouldSetCookieWithAttributeAndValue('connect.sid', 'Path', _path))
            .expect(shouldSetCookieWithAttribute('connect.sid', 'HttpOnly'))
            .expect(shouldSetCookieWithoutAttribute('connect.sid', 'Secure'))
            .expect(200, function (err) {
              if (err) return done(err);
              assert.strictEqual(cookieCallbackCalled, true, 'should have called cookie callback');
              done();
            });
        });
      });
    });
    describe('when "sameSite" set to "auto"', function () {
      describe('basic functionality', function () {
        const suiteState = {} as { server: http.Server; cookie: string };

        beforeAll(function () {
          function setup(req: TestRequest) {
            req.secure = JSON.parse(req.headers['x-secure'] as string);
          }

          function respond(req: TestRequest, res: TestResponse) {
            res.end(String(req.secure));
          }

          suiteState.server = createServer(setup, { cookie: { sameSite: 'auto' } }, respond);
        });

        it('should set SameSite=None for secure connections', function () {
          return new Promise<void>((resolve, reject) => {
            const done = (error?: unknown) => (error ? reject(error) : resolve());

            request(suiteState.server)
              .get('/')
              .set('X-Secure', 'true')
              .expect(shouldSetCookieWithAttributeAndValue('connect.sid', 'SameSite', 'None'))
              .expect(200, 'true', done);
          });
        });

        it('should set SameSite=Lax for insecure connections', function () {
          return new Promise<void>((resolve, reject) => {
            const done = (error?: unknown) => (error ? reject(error) : resolve());

            request(suiteState.server)
              .get('/')
              .set('X-Secure', 'false')
              .expect(shouldSetCookieWithAttributeAndValue('connect.sid', 'SameSite', 'Lax'))
              .expect(200, 'false', done);
          });
        });
      });

      describe('with proxy settings', function () {
        describe('when "proxy" is "true"', function () {
          const suiteState = {} as { server: http.Server; cookie: string };

          beforeAll(function () {
            suiteState.server = createServer({
              proxy: true,
              cookie: { sameSite: 'auto' },
            });
          });

          it('should set SameSite=None when X-Forwarded-Proto is https', function () {
            return new Promise<void>((resolve, reject) => {
              const done = (error?: unknown) => (error ? reject(error) : resolve());

              request(suiteState.server)
                .get('/')
                .set('X-Forwarded-Proto', 'https')
                .expect(shouldSetCookieWithAttributeAndValue('connect.sid', 'SameSite', 'None'))
                .expect(200, done);
            });
          });

          it('should set SameSite=Lax when X-Forwarded-Proto is http', function () {
            return new Promise<void>((resolve, reject) => {
              const done = (error?: unknown) => (error ? reject(error) : resolve());

              request(suiteState.server)
                .get('/')
                .set('X-Forwarded-Proto', 'http')
                .expect(shouldSetCookieWithAttributeAndValue('connect.sid', 'SameSite', 'Lax'))
                .expect(200, done);
            });
          });
        });

        describe('when "proxy" is "false"', function () {
          const suiteState = {} as { server: http.Server; cookie: string };

          beforeAll(function () {
            suiteState.server = createServer({
              proxy: false,
              cookie: { sameSite: 'auto' },
            });
          });

          it('should set SameSite=Lax when X-Forwarded-Proto is https', function () {
            return new Promise<void>((resolve, reject) => {
              const done = (error?: unknown) => (error ? reject(error) : resolve());

              request(suiteState.server)
                .get('/')
                .set('X-Forwarded-Proto', 'https')
                .expect(shouldSetCookieWithAttributeAndValue('connect.sid', 'SameSite', 'Lax'))
                .expect(200, done);
            });
          });
        });
      });

      describe('combined with secure auto', function () {
        describe('when "secure" is "auto"', function () {
          const suiteState = {} as { server: http.Server; cookie: string };

          beforeAll(function () {
            function setup(req: TestRequest) {
              req.secure = JSON.parse(req.headers['x-secure'] as string);
            }

            function respond(req: TestRequest, res: TestResponse) {
              res.end(String(req.secure));
            }

            suiteState.server = createServer(setup, { cookie: { secure: 'auto', sameSite: 'auto' } }, respond);
          });

          it('should set both Secure and SameSite=None when secure', function () {
            return new Promise<void>((resolve, reject) => {
              const done = (error?: unknown) => (error ? reject(error) : resolve());

              request(suiteState.server)
                .get('/')
                .set('X-Secure', 'true')
                .expect(shouldSetCookieWithAttribute('connect.sid', 'Secure'))
                .expect(shouldSetCookieWithAttributeAndValue('connect.sid', 'SameSite', 'None'))
                .expect(200, 'true', done);
            });
          });

          it('should set neither Secure nor SameSite=None when insecure', function () {
            return new Promise<void>((resolve, reject) => {
              const done = (error?: unknown) => (error ? reject(error) : resolve());

              request(suiteState.server)
                .get('/')
                .set('X-Secure', 'false')
                .expect(shouldSetCookieWithoutAttribute('connect.sid', 'Secure'))
                .expect(shouldSetCookieWithAttributeAndValue('connect.sid', 'SameSite', 'Lax'))
                .expect(200, 'false', done);
            });
          });
        });

        describe('when "secure" is "false"', function () {
          const suiteState = {} as { server: http.Server; cookie: string };

          beforeAll(function () {
            function setup(req: TestRequest) {
              req.secure = JSON.parse(req.headers['x-secure'] as string);
            }

            function respond(req: TestRequest, res: TestResponse) {
              res.end(String(req.secure));
            }

            suiteState.server = createServer(setup, { cookie: { secure: false, sameSite: 'auto' } }, respond);
          });

          it('should set SameSite=None without Secure when secure', function () {
            return new Promise<void>((resolve, reject) => {
              const done = (error?: unknown) => (error ? reject(error) : resolve());

              request(suiteState.server)
                .get('/')
                .set('X-Secure', 'true')
                .expect(shouldSetCookieWithoutAttribute('connect.sid', 'Secure'))
                .expect(shouldSetCookieWithAttributeAndValue('connect.sid', 'SameSite', 'None'))
                .expect(200, 'true', done);
            });
          });

          it('should set SameSite=Lax without Secure when insecure', function () {
            return new Promise<void>((resolve, reject) => {
              const done = (error?: unknown) => (error ? reject(error) : resolve());

              request(suiteState.server)
                .get('/')
                .set('X-Secure', 'false')
                .expect(shouldSetCookieWithoutAttribute('connect.sid', 'Secure'))
                .expect(shouldSetCookieWithAttributeAndValue('connect.sid', 'SameSite', 'Lax'))
                .expect(200, 'false', done);
            });
          });
        });

        describe('when "secure" is "true"', function () {
          const suiteState = {} as { server: http.Server; cookie: string };

          beforeAll(function () {
            function setup(req: TestRequest) {
              req.secure = JSON.parse(req.headers['x-secure'] as string);
            }

            function respond(req: TestRequest, res: TestResponse) {
              res.end(String(req.secure));
            }

            suiteState.server = createServer(setup, { cookie: { secure: true, sameSite: 'auto' } }, respond);
          });

          it('should set both Secure and SameSite=None when secure', function () {
            return new Promise<void>((resolve, reject) => {
              const done = (error?: unknown) => (error ? reject(error) : resolve());

              request(suiteState.server)
                .get('/')
                .set('X-Secure', 'true')
                .expect(shouldSetCookieWithAttribute('connect.sid', 'Secure'))
                .expect(shouldSetCookieWithAttributeAndValue('connect.sid', 'SameSite', 'None'))
                .expect(200, 'true', done);
            });
          });

          it('should not set cookie when insecure', function () {
            return new Promise<void>((resolve, reject) => {
              const done = (error?: unknown) => (error ? reject(error) : resolve());

              request(suiteState.server)
                .get('/')
                .set('X-Secure', 'false')
                .expect(shouldNotHaveHeader('Set-Cookie'))
                .expect(200, 'false', done);
            });
          });
        });
      });
    });
  });

  describe('session ID generation', function () {
    it('should generate a session ID', function () {
      return new Promise<void>((resolve, reject) => {
        const done = (error?: unknown) => (error ? reject(error) : resolve());

        request(createServer()).get('/').expect(shouldSetCookie('connect.sid')).expect(200, done);
      });
    });
  });

  describe('name option', function () {
    it('should default to "connect.sid"', function () {
      return new Promise<void>((resolve, reject) => {
        const done = (error?: unknown) => (error ? reject(error) : resolve());

        request(createServer()).get('/').expect(shouldSetCookie('connect.sid')).expect(200, done);
      });
    });

    it('should set the cookie name', function () {
      return new Promise<void>((resolve, reject) => {
        const done = (error?: unknown) => (error ? reject(error) : resolve());

        request(createServer({ name: 'session_id' }))
          .get('/')
          .expect(shouldSetCookie('session_id'))
          .expect(200, done);
      });
    });
  });

  describe('rolling option', function () {
    it('should default to false', function () {
      return new Promise<void>((resolve, reject) => {
        const done = (error?: unknown) => (error ? reject(error) : resolve());

        let server: http.Server = createServer(null, function (req: TestRequest, res: TestResponse) {
          req.session.user = 'bob';
          res.end();
        });

        request(server)
          .get('/')
          .expect(shouldSetCookie('connect.sid'))
          .expect(200, function (err, res) {
            if (err) return done(err);
            request(server)
              .get('/')
              .set('Cookie', cookie(res))
              .expect(shouldNotHaveHeader('Set-Cookie'))
              .expect(200, done);
          });
      });
    });

    it('should force cookie on unmodified session', function () {
      return new Promise<void>((resolve, reject) => {
        const done = (error?: unknown) => (error ? reject(error) : resolve());

        let server: http.Server = createServer({ rolling: true }, function (req: TestRequest, res: TestResponse) {
          req.session.user = 'bob';
          res.end();
        });

        request(server)
          .get('/')
          .expect(shouldSetCookie('connect.sid'))
          .expect(200, function (err, res) {
            if (err) return done(err);
            request(server)
              .get('/')
              .set('Cookie', cookie(res))
              .expect(shouldSetCookie('connect.sid'))
              .expect(200, done);
          });
      });
    });

    it('should not force cookie on uninitialized session if saveUninitialized option is set to false', function () {
      return new Promise<void>((resolve, reject) => {
        const done = (error?: unknown) => (error ? reject(error) : resolve());

        let store = new session.MemoryStore();
        let server: http.Server = createServer({
          store: store,
          rolling: true,
          saveUninitialized: false,
        });

        request(server)
          .get('/')
          .expect(shouldNotSetSessionInStore(store))
          .expect(shouldNotHaveHeader('Set-Cookie'))
          .expect(200, done);
      });
    });

    it('should force cookie and save uninitialized session if saveUninitialized option is set to true', function () {
      return new Promise<void>((resolve, reject) => {
        const done = (error?: unknown) => (error ? reject(error) : resolve());

        let store = new session.MemoryStore();
        let server: http.Server = createServer({
          store: store,
          rolling: true,
          saveUninitialized: true,
        });

        request(server)
          .get('/')
          .expect(shouldSetSessionInStore(store))
          .expect(shouldSetCookie('connect.sid'))
          .expect(200, done);
      });
    });

    it('should force cookie and save modified session even if saveUninitialized option is set to false', function () {
      return new Promise<void>((resolve, reject) => {
        const done = (error?: unknown) => (error ? reject(error) : resolve());

        let store = new session.MemoryStore();
        let server: http.Server = createServer(
          { store: store, rolling: true, saveUninitialized: false },
          function (req: TestRequest, res: TestResponse) {
            req.session.user = 'bob';
            res.end();
          },
        );

        request(server)
          .get('/')
          .expect(shouldSetSessionInStore(store))
          .expect(shouldSetCookie('connect.sid'))
          .expect(200, done);
      });
    });
  });

  describe('resave option', function () {
    it('should default to true', function () {
      return new Promise<void>((resolve, reject) => {
        const done = (error?: unknown) => (error ? reject(error) : resolve());

        let store = new session.MemoryStore();
        let server: http.Server = createServer({ store: store }, function (req: TestRequest, res: TestResponse) {
          req.session.user = 'bob';
          res.end();
        });

        request(server)
          .get('/')
          .expect(shouldSetSessionInStore(store))
          .expect(200, function (err, res) {
            if (err) return done(err);
            request(server)
              .get('/')
              .set('Cookie', cookie(res))
              .expect(shouldSetSessionInStore(store))
              .expect(200, done);
          });
      });
    });

    describe('when true', function () {
      it('should force save on unmodified session', function () {
        return new Promise<void>((resolve, reject) => {
          const done = (error?: unknown) => (error ? reject(error) : resolve());

          let store = new session.MemoryStore();
          let server: http.Server = createServer(
            { store: store, resave: true },
            function (req: TestRequest, res: TestResponse) {
              req.session.user = 'bob';
              res.end();
            },
          );

          request(server)
            .get('/')
            .expect(shouldSetSessionInStore(store))
            .expect(200, function (err, res) {
              if (err) return done(err);
              request(server)
                .get('/')
                .set('Cookie', cookie(res))
                .expect(shouldSetSessionInStore(store))
                .expect(200, done);
            });
        });
      });
    });

    describe('when false', function () {
      it('should prevent save on unmodified session', function () {
        return new Promise<void>((resolve, reject) => {
          const done = (error?: unknown) => (error ? reject(error) : resolve());

          let store = new session.MemoryStore();
          let server: http.Server = createServer(
            { store: store, resave: false },
            function (req: TestRequest, res: TestResponse) {
              req.session.user = 'bob';
              res.end();
            },
          );

          request(server)
            .get('/')
            .expect(shouldSetSessionInStore(store))
            .expect(200, function (err, res) {
              if (err) return done(err);
              request(server)
                .get('/')
                .set('Cookie', cookie(res))
                .expect(shouldNotSetSessionInStore(store))
                .expect(200, done);
            });
        });
      });

      it('should still save modified session', function () {
        return new Promise<void>((resolve, reject) => {
          const done = (error?: unknown) => (error ? reject(error) : resolve());

          let store = new session.MemoryStore();
          let server: http.Server = createServer(
            { resave: false, store: store },
            function (req: TestRequest, res: TestResponse) {
              if (req.method === 'PUT') {
                req.session.token = req.url.substr(1);
              }
              res.end('token=' + (req.session.token || ''));
            },
          );

          request(server)
            .put('/w6RHhwaA')
            .expect(200)
            .expect(shouldSetSessionInStore(store))
            .expect('token=w6RHhwaA')
            .end(function (err, res) {
              if (err) return done(err);
              let sess = cookie(res);
              request(server)
                .get('/')
                .set('Cookie', sess)
                .expect(200)
                .expect(shouldNotSetSessionInStore(store))
                .expect('token=w6RHhwaA')
                .end(function (err) {
                  if (err) return done(err);
                  request(server)
                    .put('/zfQ3rzM3')
                    .set('Cookie', sess)
                    .expect(200)
                    .expect(shouldSetSessionInStore(store))
                    .expect('token=zfQ3rzM3')
                    .end(done);
                });
            });
        });
      });

      it('should detect a "cookie" property as modified', function () {
        return new Promise<void>((resolve, reject) => {
          const done = (error?: unknown) => (error ? reject(error) : resolve());

          let store = new session.MemoryStore();
          let server: http.Server = createServer(
            { store: store, resave: false },
            function (req: TestRequest, res: TestResponse) {
              req.session.user = req.session.user || {};
              req.session.user.name = 'bob';
              req.session.user.cookie = req.session.user.cookie || 0;
              req.session.user.cookie++;
              res.end();
            },
          );

          request(server)
            .get('/')
            .expect(shouldSetSessionInStore(store))
            .expect(200, function (err, res) {
              if (err) return done(err);
              request(server)
                .get('/')
                .set('Cookie', cookie(res))
                .expect(shouldSetSessionInStore(store))
                .expect(200, done);
            });
        });
      });

      it('should pass session touch error', async function () {
        let store = new session.MemoryStore();
        let server: http.Server = createServer(
          { store: store, resave: false },
          function (req: TestRequest, res: TestResponse) {
            req.session.hit = true;
            res.end('session saved');
          },
        );

        store.touch = function touch(sid, sess, callback) {
          callback(new Error('boom!'));
        };

        const errorReceived = once(server, 'error').then(([err]) => {
          assert.ok(err);
          assert.strictEqual(err.message, 'boom!');
        });

        await Promise.all([
          errorReceived,
          (async () => {
            const res = await request(server).get('/').expect(200, 'session saved');
            await request(server).get('/').set('Cookie', cookie(res)).expect(200);
          })(),
        ]);
      });
    });
  });

  describe('saveUninitialized option', function () {
    it('should default to true', function () {
      return new Promise<void>((resolve, reject) => {
        const done = (error?: unknown) => (error ? reject(error) : resolve());

        let store = new session.MemoryStore();
        let server: http.Server = createServer({ store: store });

        request(server)
          .get('/')
          .expect(shouldSetSessionInStore(store))
          .expect(shouldSetCookie('connect.sid'))
          .expect(200, done);
      });
    });

    it('should force save of uninitialized session', function () {
      return new Promise<void>((resolve, reject) => {
        const done = (error?: unknown) => (error ? reject(error) : resolve());

        let store = new session.MemoryStore();
        let server: http.Server = createServer({
          store: store,
          saveUninitialized: true,
        });

        request(server)
          .get('/')
          .expect(shouldSetSessionInStore(store))
          .expect(shouldSetCookie('connect.sid'))
          .expect(200, done);
      });
    });

    it('should prevent save of uninitialized session', function () {
      return new Promise<void>((resolve, reject) => {
        const done = (error?: unknown) => (error ? reject(error) : resolve());

        let store = new session.MemoryStore();
        let server: http.Server = createServer({
          store: store,
          saveUninitialized: false,
        });

        request(server)
          .get('/')
          .expect(shouldNotSetSessionInStore(store))
          .expect(shouldNotHaveHeader('Set-Cookie'))
          .expect(200, done);
      });
    });

    it('should still save modified session', function () {
      return new Promise<void>((resolve, reject) => {
        const done = (error?: unknown) => (error ? reject(error) : resolve());

        let store = new session.MemoryStore();
        let server: http.Server = createServer(
          { store: store, saveUninitialized: false },
          function (req: TestRequest, res: TestResponse) {
            req.session.count = req.session.count || 0;
            req.session.count++;
            res.end();
          },
        );

        request(server)
          .get('/')
          .expect(shouldSetSessionInStore(store))
          .expect(shouldSetCookie('connect.sid'))
          .expect(200, done);
      });
    });

    it('should pass session save error', async function () {
      let store = new session.MemoryStore();
      let server: http.Server = createServer(
        { store: store, saveUninitialized: true },
        function (req: TestRequest, res: TestResponse) {
          res.end('session saved');
        },
      );

      store.set = function destroy(sid, sess, callback) {
        callback(new Error('boom!'));
      };

      const errorReceived = once(server, 'error').then(([err]) => {
        assert.ok(err);
        assert.strictEqual(err.message, 'boom!');
      });

      await Promise.all([errorReceived, request(server).get('/').expect(200, 'session saved')]);
    });

    it('should prevent uninitialized session from being touched', async function () {
      let store = new session.MemoryStore();
      let server: http.Server = createServer(
        { saveUninitialized: false, store: store, cookie: { maxAge: min } },
        function (req: TestRequest, res: TestResponse) {
          res.end();
        },
      );

      let touches = 0;
      store.touch = function (_id, _data, callback) {
        touches++;
        callback?.();
      };

      await request(server).get('/').expect(200);
      assert.equal(touches, 0);
    });
  });

  describe('unset option', function () {
    it('should reject unknown values', function () {
      assert.throws(session.bind(null, { unset: 'bogus!' }), /unset.*must/);
    });

    it('should default to keep', function () {
      return new Promise<void>((resolve, reject) => {
        const done = (error?: unknown) => (error ? reject(error) : resolve());

        let store = new session.MemoryStore();
        let server: http.Server = createServer({ store: store }, function (req: TestRequest, res: TestResponse) {
          req.session.count = req.session.count || 0;
          req.session.count++;
          if (req.session.count === 2) req.session = null;
          res.end();
        });

        request(server)
          .get('/')
          .expect(200, function (err, res) {
            if (err) return done(err);
            store.length(function (err, len) {
              if (err) return done(err);
              assert.strictEqual(len, 1);
              request(server)
                .get('/')
                .set('Cookie', cookie(res))
                .expect(200, function (err, res) {
                  if (err) return done(err);
                  store.length(function (err, len) {
                    if (err) return done(err);
                    assert.strictEqual(len, 1);
                    done();
                  });
                });
            });
          });
      });
    });

    it('should allow destroy on req.session = null', function () {
      return new Promise<void>((resolve, reject) => {
        const done = (error?: unknown) => (error ? reject(error) : resolve());

        let store = new session.MemoryStore();
        let server: http.Server = createServer(
          { store: store, unset: 'destroy' },
          function (req: TestRequest, res: TestResponse) {
            req.session.count = req.session.count || 0;
            req.session.count++;
            if (req.session.count === 2) req.session = null;
            res.end();
          },
        );

        request(server)
          .get('/')
          .expect(200, function (err, res) {
            if (err) return done(err);
            store.length(function (err, len) {
              if (err) return done(err);
              assert.strictEqual(len, 1);
              request(server)
                .get('/')
                .set('Cookie', cookie(res))
                .expect(200, function (err, res) {
                  if (err) return done(err);
                  store.length(function (err, len) {
                    if (err) return done(err);
                    assert.strictEqual(len, 0);
                    done();
                  });
                });
            });
          });
      });
    });

    it('should not set cookie if initial session destroyed', function () {
      return new Promise<void>((resolve, reject) => {
        const done = (error?: unknown) => (error ? reject(error) : resolve());

        let store = new session.MemoryStore();
        let server: http.Server = createServer(
          { store: store, unset: 'destroy' },
          function (req: TestRequest, res: TestResponse) {
            req.session = null;
            res.end();
          },
        );

        request(server)
          .get('/')
          .expect(shouldNotHaveHeader('Set-Cookie'))
          .expect(200, function (err, res) {
            if (err) return done(err);
            store.length(function (err, len) {
              if (err) return done(err);
              assert.strictEqual(len, 0);
              done();
            });
          });
      });
    });

    it('should pass session destroy error', async function () {
      let store = new session.MemoryStore();
      let server: http.Server = createServer(
        { store: store, unset: 'destroy' },
        function (req: TestRequest, res: TestResponse) {
          req.session = null;
          res.end('session destroyed');
        },
      );

      store.destroy = function destroy(sid, callback) {
        callback(new Error('boom!'));
      };

      const errorReceived = once(server, 'error').then(([err]) => {
        assert.ok(err);
        assert.strictEqual(err.message, 'boom!');
      });

      await Promise.all([errorReceived, request(server).get('/').expect(200, 'session destroyed')]);
    });
  });

  describe('res.end patch', function () {
    it('should correctly handle res.end/res.write patched prior', function () {
      return new Promise<void>((resolve, reject) => {
        const done = (error?: unknown) => (error ? reject(error) : resolve());

        function setup(req: TestRequest, res: TestResponse) {
          utils.writePatch(res);
        }

        function respond(req: TestRequest, res: TestResponse) {
          req.session.hit = true;
          res.write('hello, ');
          res.end('world');
        }

        request(createServer(setup, null, respond))
          .get('/')
          .expect(200, 'hello, world', done);
      });
    });

    it('should correctly handle res.end/res.write patched after', function () {
      return new Promise<void>((resolve, reject) => {
        const done = (error?: unknown) => (error ? reject(error) : resolve());

        function respond(req: TestRequest, res: TestResponse) {
          utils.writePatch(res);
          req.session.hit = true;
          res.write('hello, ');
          res.end('world');
        }

        request(createServer(null, respond)).get('/').expect(200, 'hello, world', done);
      });
    });

    it('should error when res.end is called twice', function () {
      return new Promise<void>((resolve, reject) => {
        const done = (error?: unknown) => (error ? reject(error) : resolve());

        let error1 = null;
        let error2 = null;
        let server: http.Server = http.createServer(function (req: TestRequest, res: TestResponse) {
          res.end();

          try {
            res.setHeader('Content-Length', '3');
            res.end('foo');
          } catch (e) {
            error1 = e;
          }
        });

        function respond(req: TestRequest, res: TestResponse) {
          res.end();

          try {
            res.setHeader('Content-Length', '3');
            res.end('foo');
          } catch (e) {
            error2 = e;
          }
        }

        request(server)
          .get('/')
          .end(function (err, res) {
            if (err) return done(err);
            request(createServer(null, respond))
              .get('/')
              .expect(function () {
                assert.strictEqual(error1 && error1.message, error2 && error2.message);
              })
              .expect(res.statusCode, res.text, done);
          });
      });
    });
  });

  describe('req.session', function () {
    it('should persist', function () {
      return new Promise<void>((resolve, reject) => {
        const done = (error?: unknown) => (error ? reject(error) : resolve());

        let store = new session.MemoryStore();
        let server: http.Server = createServer({ store: store }, function (req: TestRequest, res: TestResponse) {
          req.session.count = req.session.count || 0;
          req.session.count++;
          res.end('hits: ' + req.session.count);
        });

        request(server)
          .get('/')
          .expect(200, 'hits: 1', function (err, res) {
            if (err) return done(err);
            store.load(sid(res), function (err, sess) {
              if (err) return done(err);
              assert.ok(sess);
              request(server).get('/').set('Cookie', cookie(res)).expect(200, 'hits: 2', done);
            });
          });
      });
    });

    it('should only set-cookie when modified', function () {
      return new Promise<void>((resolve, reject) => {
        const done = (error?: unknown) => (error ? reject(error) : resolve());

        let modify = true;
        let server: http.Server = createServer(null, function (req: TestRequest, res: TestResponse) {
          if (modify) {
            req.session.count = req.session.count || 0;
            req.session.count++;
          }
          res.end(req.session.count.toString());
        });

        request(server)
          .get('/')
          .expect(200, '1', function (err, res) {
            if (err) return done(err);
            request(server)
              .get('/')
              .set('Cookie', cookie(res))
              .expect(200, '2', function (err, res) {
                if (err) return done(err);
                let val = cookie(res);
                modify = false;

                request(server)
                  .get('/')
                  .set('Cookie', val)
                  .expect(shouldNotHaveHeader('Set-Cookie'))
                  .expect(200, '2', function (err, res) {
                    if (err) return done(err);
                    modify = true;

                    request(server)
                      .get('/')
                      .set('Cookie', val)
                      .expect(shouldSetCookie('connect.sid'))
                      .expect(200, '3', done);
                  });
              });
          });
      });
    });

    it('should not have enumerable methods', function () {
      return new Promise<void>((resolve, reject) => {
        const done = (error?: unknown) => (error ? reject(error) : resolve());

        let server: http.Server = createServer(null, function (req: TestRequest, res: TestResponse) {
          req.session.foo = 'foo';
          req.session.bar = 'bar';
          let keys = [];
          for (let key in req.session) {
            keys.push(key);
          }
          res.end(keys.sort().join(','));
        });

        request(server).get('/').expect(200, 'bar,cookie,foo', done);
      });
    });

    it('should not be set if store is disconnected', function () {
      return new Promise<void>((resolve, reject) => {
        const done = (error?: unknown) => (error ? reject(error) : resolve());

        let store = new session.MemoryStore();
        let server: http.Server = createServer({ store: store }, function (req: TestRequest, res: TestResponse) {
          res.end(typeof req.session);
        });

        store.emit('disconnect');

        request(server).get('/').expect(shouldNotHaveHeader('Set-Cookie')).expect(200, 'undefined', done);
      });
    });

    it('should be set when store reconnects', function () {
      return new Promise<void>((resolve, reject) => {
        const done = (error?: unknown) => (error ? reject(error) : resolve());

        let store = new session.MemoryStore();
        let server: http.Server = createServer({ store: store }, function (req: TestRequest, res: TestResponse) {
          res.end(typeof req.session);
        });

        store.emit('disconnect');

        request(server)
          .get('/')
          .expect(shouldNotHaveHeader('Set-Cookie'))
          .expect(200, 'undefined', function (err) {
            if (err) return done(err);

            store.emit('connect');

            request(server).get('/').expect(200, 'object', done);
          });
      });
    });

    describe('.destroy()', function () {
      it('should destroy the previous session', function () {
        return new Promise<void>((resolve, reject) => {
          const done = (error?: unknown) => (error ? reject(error) : resolve());

          let server: http.Server = createServer(null, function (req: TestRequest, res: TestResponse) {
            req.session.destroy(function (err) {
              if (err) res.statusCode = 500;
              res.end(String(req.session));
            });
          });

          request(server).get('/').expect(shouldNotHaveHeader('Set-Cookie')).expect(200, 'undefined', done);
        });
      });
    });

    describe('.regenerate()', function () {
      it('should destroy/replace the previous session', function () {
        return new Promise<void>((resolve, reject) => {
          const done = (error?: unknown) => (error ? reject(error) : resolve());

          let server: http.Server = createServer(null, function (req: TestRequest, res: TestResponse) {
            let id = req.session.id;
            req.session.regenerate(function (err) {
              if (err) res.statusCode = 500;
              res.end(String(req.session.id === id));
            });
          });

          request(server)
            .get('/')
            .expect(shouldSetCookie('connect.sid'))
            .expect(200, function (err, res) {
              if (err) return done(err);
              request(server)
                .get('/')
                .set('Cookie', cookie(res))
                .expect(shouldSetCookie('connect.sid'))
                .expect(shouldSetCookieToDifferentSessionId(sid(res)))
                .expect(200, 'false', done);
            });
        });
      });
    });

    describe('.reload()', function () {
      it('should reload session from store', function () {
        return new Promise<void>((resolve, reject) => {
          const done = (error?: unknown) => (error ? reject(error) : resolve());

          let server: http.Server = createServer(null, function (req: TestRequest, res: TestResponse) {
            if (req.url === '/') {
              req.session.active = true;
              res.end('session created');
              return;
            }

            req.session.url = req.url;

            if (req.url === '/bar') {
              res.end('saw ' + req.session.url);
              return;
            }

            request(server)
              .get('/bar')
              .set('Cookie', val)
              .expect(200, 'saw /bar', function (err, resp) {
                if (err) return done(err);
                req.session.reload(function (err) {
                  if (err) return done(err);
                  res.end('saw ' + req.session.url);
                });
              });
          });
          let val;

          request(server)
            .get('/')
            .expect(200, 'session created', function (err, res) {
              if (err) return done(err);
              val = cookie(res);
              request(server).get('/foo').set('Cookie', val).expect(200, 'saw /bar', done);
            });
        });
      });

      it('should error is session missing', function () {
        return new Promise<void>((resolve, reject) => {
          const done = (error?: unknown) => (error ? reject(error) : resolve());

          let store = new session.MemoryStore();
          let server: http.Server = createServer({ store: store }, function (req: TestRequest, res: TestResponse) {
            if (req.url === '/') {
              req.session.active = true;
              res.end('session created');
              return;
            }

            store.clear(function (err) {
              if (err) return done(err);
              req.session.reload(function (err) {
                res.statusCode = err ? 500 : 200;
                res.end(err ? err.message : '');
              });
            });
          });

          request(server)
            .get('/')
            .expect(200, 'session created', function (err, res) {
              if (err) return done(err);
              request(server).get('/foo').set('Cookie', cookie(res)).expect(500, 'failed to load session', done);
            });
        });
      });

      it('should not override an overridden `reload` in case of errors', function () {
        return new Promise<void>((resolve, reject) => {
          const done = (error?: unknown) => (error ? reject(error) : resolve());

          let store = new session.MemoryStore();
          let server: http.Server = createServer(
            { store: store, resave: false },
            function (req: TestRequest, res: TestResponse) {
              if (req.url === '/') {
                req.session.active = true;
                res.end('session created');
                return;
              }

              store.clear(function (err) {
                if (err) return done(err);

                // reload way too many times on top of each other,
                // attempting to overflow the call stack
                let iters = 20;
                reload();
                function reload() {
                  if (!--iters) {
                    res.end('ok');
                    return;
                  }

                  try {
                    req.session.reload(reload);
                  } catch (e) {
                    res.statusCode = 500;
                    res.end(e.message);
                  }
                }
              });
            },
          );

          request(server)
            .get('/')
            .expect(200, 'session created', function (err, res) {
              if (err) return done(err);
              request(server).get('/foo').set('Cookie', cookie(res)).expect(200, 'ok', done);
            });
        });
      });
    });

    describe('.save()', function () {
      it('should save session to store', function () {
        return new Promise<void>((resolve, reject) => {
          const done = (error?: unknown) => (error ? reject(error) : resolve());

          let store = new session.MemoryStore();
          let server: http.Server = createServer({ store: store }, function (req: TestRequest, res: TestResponse) {
            req.session.hit = true;
            req.session.save(function (err) {
              if (err) return res.end(err.message);
              store.get(req.session.id, function (err, sess) {
                if (err) return res.end(err.message);
                res.end(sess ? 'stored' : 'empty');
              });
            });
          });

          request(server).get('/').expect(200, 'stored', done);
        });
      });

      it('should prevent end-of-request save', function () {
        return new Promise<void>((resolve, reject) => {
          const done = (error?: unknown) => (error ? reject(error) : resolve());

          let store = new session.MemoryStore();
          let server: http.Server = createServer({ store: store }, function (req: TestRequest, res: TestResponse) {
            req.session.hit = true;
            req.session.save(function (err) {
              if (err) return res.end(err.message);
              res.end('saved');
            });
          });

          request(server)
            .get('/')
            .expect(shouldSetSessionInStore(store))
            .expect(200, 'saved', function (err, res) {
              if (err) return done(err);
              request(server)
                .get('/')
                .set('Cookie', cookie(res))
                .expect(shouldSetSessionInStore(store))
                .expect(200, 'saved', done);
            });
        });
      });

      it('should prevent end-of-request save on reloaded session', function () {
        return new Promise<void>((resolve, reject) => {
          const done = (error?: unknown) => (error ? reject(error) : resolve());

          let store = new session.MemoryStore();
          let server: http.Server = createServer({ store: store }, function (req: TestRequest, res: TestResponse) {
            req.session.hit = true;
            req.session.reload(function () {
              req.session.save(function (err) {
                if (err) return res.end(err.message);
                res.end('saved');
              });
            });
          });

          request(server)
            .get('/')
            .expect(shouldSetSessionInStore(store))
            .expect(200, 'saved', function (err, res) {
              if (err) return done(err);
              request(server)
                .get('/')
                .set('Cookie', cookie(res))
                .expect(shouldSetSessionInStore(store))
                .expect(200, 'saved', done);
            });
        });
      });

      describe('when saveUninitialized is false', function () {
        it('should prevent end-of-request save', function () {
          return new Promise<void>((resolve, reject) => {
            const done = (error?: unknown) => (error ? reject(error) : resolve());

            let store = new session.MemoryStore();
            let server: http.Server = createServer(
              { saveUninitialized: false, store: store },
              function (req: TestRequest, res: TestResponse) {
                req.session.hit = true;
                req.session.save(function (err) {
                  if (err) return res.end(err.message);
                  res.end('saved');
                });
              },
            );

            request(server)
              .get('/')
              .expect(shouldSetSessionInStore(store))
              .expect(200, 'saved', function (err, res) {
                if (err) return done(err);
                request(server)
                  .get('/')
                  .set('Cookie', cookie(res))
                  .expect(shouldSetSessionInStore(store))
                  .expect(200, 'saved', done);
              });
          });
        });
      });
    });

    describe('.touch()', function () {
      it('should reset session expiration', function () {
        return new Promise<void>((resolve, reject) => {
          const done = (error?: unknown) => (error ? reject(error) : resolve());

          let store = new session.MemoryStore();
          let server: http.Server = createServer(
            { resave: false, store: store, cookie: { maxAge: min } },
            function (req: TestRequest, res: TestResponse) {
              req.session.hit = true;
              req.session.touch();
              res.end();
            },
          );

          request(server)
            .get('/')
            .expect(200, function (err, res) {
              if (err) return done(err);
              let id = sid(res);
              store.get(id, function (err, sess) {
                if (err) return done(err);
                let exp = new Date(sess!.cookie.expires as string);
                setTimeout(function () {
                  request(server)
                    .get('/')
                    .set('Cookie', cookie(res))
                    .expect(200, function (err, res) {
                      if (err) return done(err);
                      store.get(id, function (err, sess) {
                        if (err) return done(err);
                        assert.notStrictEqual(new Date(sess!.cookie.expires as string).getTime(), exp.getTime());
                        done();
                      });
                    });
                }, 100);
              });
            });
        });
      });
    });

    describe('.cookie', function () {
      describe('.*', function () {
        it('should serialize as parameters', function () {
          return new Promise<void>((resolve, reject) => {
            const done = (error?: unknown) => (error ? reject(error) : resolve());

            let server: http.Server = createServer({ proxy: true }, function (req: TestRequest, res: TestResponse) {
              req.session.cookie.httpOnly = false;
              req.session.cookie.secure = true;
              res.end();
            });

            request(server)
              .get('/')
              .set('X-Forwarded-Proto', 'https')
              .expect(shouldSetCookieWithoutAttribute('connect.sid', 'HttpOnly'))
              .expect(shouldSetCookieWithAttribute('connect.sid', 'Secure'))
              .expect(200, done);
          });
        });

        it('should default to a browser-session length cookie', function () {
          return new Promise<void>((resolve, reject) => {
            const done = (error?: unknown) => (error ? reject(error) : resolve());

            request(createServer({ cookie: { path: '/admin' } }))
              .get('/admin')
              .expect(shouldSetCookieWithoutAttribute('connect.sid', 'Expires'))
              .expect(200, done);
          });
        });

        it('should Set-Cookie only once for browser-session cookies', function () {
          return new Promise<void>((resolve, reject) => {
            const done = (error?: unknown) => (error ? reject(error) : resolve());

            let server: http.Server = createServer({
              cookie: { path: '/admin' },
            });

            request(server)
              .get('/admin/foo')
              .expect(shouldSetCookie('connect.sid'))
              .expect(200, function (err, res) {
                if (err) return done(err);
                request(server)
                  .get('/admin')
                  .set('Cookie', cookie(res))
                  .expect(shouldNotHaveHeader('Set-Cookie'))
                  .expect(200, done);
              });
          });
        });

        it('should override defaults', function () {
          return new Promise<void>((resolve, reject) => {
            const done = (error?: unknown) => (error ? reject(error) : resolve());

            let opts = {
              httpOnly: false,
              maxAge: 5000,
              path: '/admin',
              priority: 'high',
              secure: true,
            };
            let server: http.Server = createServer({ cookie: opts }, function (req: TestRequest, res: TestResponse) {
              req.session.cookie.secure = false;
              res.end();
            });

            request(server)
              .get('/admin')
              .expect(shouldSetCookieWithAttribute('connect.sid', 'Expires'))
              .expect(shouldSetCookieWithoutAttribute('connect.sid', 'HttpOnly'))
              .expect(shouldSetCookieWithAttributeAndValue('connect.sid', 'Path', '/admin'))
              .expect(shouldSetCookieWithoutAttribute('connect.sid', 'Secure'))
              .expect(shouldSetCookieWithAttributeAndValue('connect.sid', 'Priority', 'High'))
              .expect(200, done);
          });
        });

        it('should forward errors setting cookie', async function () {
          let server: http.Server = createServer(
            { cookie: { expires: new Date(NaN) } },
            function (req: TestRequest, res: TestResponse) {
              res.end();
            },
          );

          const errorReceived = once(server, 'error').then(([err]) => {
            assert.ok(err);
            assert.ok(err instanceof TypeError);
            assert.match(err.message, /^option expires is invalid(?:: Invalid Date)?$/);
          });

          await Promise.all([errorReceived, request(server).get('/admin').expect(200)]);
        });

        it('should preserve cookies set before writeHead is called', function () {
          return new Promise<void>((resolve, reject) => {
            const done = (error?: unknown) => (error ? reject(error) : resolve());

            let server: http.Server = createServer(null, function (req: TestRequest, res: TestResponse) {
              let cookie = new Cookie();
              res.setHeader('Set-Cookie', cookie.serialize('previous', 'cookieValue'));
              res.end();
            });

            request(server).get('/').expect(shouldSetCookieToValue('previous', 'cookieValue')).expect(200, done);
          });
        });

        it('should preserve cookies set in writeHead', function () {
          return new Promise<void>((resolve, reject) => {
            const done = (error?: unknown) => (error ? reject(error) : resolve());

            let server: http.Server = createServer(null, function (req: TestRequest, res: TestResponse) {
              let cookie = new Cookie();
              res.writeHead(200, {
                'Set-Cookie': cookie.serialize('previous', 'cookieValue'),
              });
              res.end();
            });

            request(server).get('/').expect(shouldSetCookieToValue('previous', 'cookieValue')).expect(200, done);
          });
        });
      });

      describe('.originalMaxAge', function () {
        it('should equal original maxAge', function () {
          return new Promise<void>((resolve, reject) => {
            const done = (error?: unknown) => (error ? reject(error) : resolve());

            let server: http.Server = createServer(
              { cookie: { maxAge: 2000 } },
              function (req: TestRequest, res: TestResponse) {
                res.end(JSON.stringify(req.session.cookie.originalMaxAge));
              },
            );

            request(server)
              .get('/')
              .expect(200)
              .expect(function (res) {
                // account for 1ms latency
                assert.ok(res.text === '2000' || res.text === '1999', 'expected 2000, got ' + res.text);
              })
              .end(done);
          });
        });

        it('should equal original maxAge for all requests', function () {
          return new Promise<void>((resolve, reject) => {
            const done = (error?: unknown) => (error ? reject(error) : resolve());

            let server: http.Server = createServer(
              { cookie: { maxAge: 2000 } },
              function (req: TestRequest, res: TestResponse) {
                res.end(JSON.stringify(req.session.cookie.originalMaxAge));
              },
            );

            request(server)
              .get('/')
              .expect(200)
              .expect(function (res) {
                // account for 1ms latency
                assert.ok(res.text === '2000' || res.text === '1999', 'expected 2000, got ' + res.text);
              })
              .end(function (err, res) {
                if (err) return done(err);
                setTimeout(function () {
                  request(server)
                    .get('/')
                    .set('Cookie', cookie(res))
                    .expect(200)
                    .expect(function (res) {
                      // account for 1ms latency
                      assert.ok(res.text === '2000' || res.text === '1999', 'expected 2000, got ' + res.text);
                    })
                    .end(done);
                }, 100);
              });
          });
        });

        it('should equal original maxAge for all requests', function () {
          return new Promise<void>((resolve, reject) => {
            const done = (error?: unknown) => (error ? reject(error) : resolve());

            let store = new SmartStore();
            let server: http.Server = createServer(
              { cookie: { maxAge: 2000 }, store: store },
              function (req: TestRequest, res: TestResponse) {
                res.end(JSON.stringify(req.session.cookie.originalMaxAge));
              },
            );

            request(server)
              .get('/')
              .expect(200)
              .expect(function (res) {
                // account for 1ms latency
                assert.ok(res.text === '2000' || res.text === '1999', 'expected 2000, got ' + res.text);
              })
              .end(function (err, res) {
                if (err) return done(err);
                setTimeout(function () {
                  request(server)
                    .get('/')
                    .set('Cookie', cookie(res))
                    .expect(200)
                    .expect(function (res) {
                      // account for 1ms latency
                      assert.ok(res.text === '2000' || res.text === '1999', 'expected 2000, got ' + res.text);
                    })
                    .end(done);
                }, 100);
              });
          });
        });
      });

      describe('.secure', function () {
        let app: Handler;

        beforeAll(function () {
          app = createRequestListener({
            cookie: { secure: true },
          });
        });

        it('should set cookie when secure', function () {
          return new Promise<void>((resolve, reject) => {
            const done = (error?: unknown) => (error ? reject(error) : resolve());

            let cert = fs.readFileSync(import.meta.dirname + '/fixtures/server.crt', 'ascii');
            let server: http.Server = https.createServer({
              key: fs.readFileSync(import.meta.dirname + '/fixtures/server.key', 'ascii'),
              cert: cert,
            });

            server.on('request', app);

            let agent = new https.Agent({ ca: cert });
            let createConnection = agent.createConnection;

            agent.createConnection = function (options) {
              options.servername = 'express-session.local';
              return createConnection.call(this, options);
            };

            let req = request(server).get('/');
            req.agent(agent);
            req.expect(shouldSetCookie('connect.sid'));
            req.expect(200, done);
          });
        });

        it('should not set-cookie when insecure', function () {
          return new Promise<void>((resolve, reject) => {
            const done = (error?: unknown) => (error ? reject(error) : resolve());

            let server: http.Server = http.createServer(app);

            request(server).get('/').expect(shouldNotHaveHeader('Set-Cookie')).expect(200, done);
          });
        });
      });

      describe('.maxAge', function () {
        const suiteState = {} as { server: http.Server; cookie: string };

        beforeAll(function () {
          return new Promise<void>((resolve, reject) => {
            const done = (error?: unknown) => (error ? reject(error) : resolve());

            let ctx = suiteState;

            ctx.cookie = '';
            ctx.server = createServer({ cookie: { maxAge: 2000 } }, function (req: TestRequest, res: TestResponse) {
              switch (++req.session.count) {
                case 1:
                  break;
                case 2:
                  req.session.cookie.maxAge = 5000;
                  break;
                case 3:
                  req.session.cookie.maxAge = 3000000000;
                  break;
                default:
                  req.session.count = 0;
                  break;
              }
              res.end(req.session.count.toString());
            });

            request(ctx.server)
              .get('/')
              .end(function (err, res) {
                ctx.cookie = res && cookie(res);
                done(err);
              });
          });
        });

        it('should set cookie expires relative to maxAge', function () {
          return new Promise<void>((resolve, reject) => {
            const done = (error?: unknown) => (error ? reject(error) : resolve());

            request(suiteState.server)
              .get('/')
              .set('Cookie', suiteState.cookie)
              .expect(shouldSetCookieToExpireIn('connect.sid', 2000))
              .expect(200, '1', done);
          });
        });

        it('should modify cookie expires when changed', function () {
          return new Promise<void>((resolve, reject) => {
            const done = (error?: unknown) => (error ? reject(error) : resolve());

            request(suiteState.server)
              .get('/')
              .set('Cookie', suiteState.cookie)
              .expect(shouldSetCookieToExpireIn('connect.sid', 5000))
              .expect(200, '2', done);
          });
        });

        it('should modify cookie expires when changed to large value', function () {
          return new Promise<void>((resolve, reject) => {
            const done = (error?: unknown) => (error ? reject(error) : resolve());

            request(suiteState.server)
              .get('/')
              .set('Cookie', suiteState.cookie)
              .expect(shouldSetCookieToExpireIn('connect.sid', 3000000000))
              .expect(200, '3', done);
          });
        });
      });

      describe('.expires', function () {
        describe('when given a Date', function () {
          it('should set absolute', function () {
            return new Promise<void>((resolve, reject) => {
              const done = (error?: unknown) => (error ? reject(error) : resolve());

              let server: http.Server = createServer(null, function (req: TestRequest, res: TestResponse) {
                req.session.cookie.expires = new Date(0);
                res.end();
              });

              request(server)
                .get('/')
                .expect(shouldSetCookieWithAttributeAndValue('connect.sid', 'Expires', 'Thu, 01 Jan 1970 00:00:00 GMT'))
                .expect(200, done);
            });
          });
        });

        describe('when null', function () {
          it('should be a browser-session cookie', function () {
            return new Promise<void>((resolve, reject) => {
              const done = (error?: unknown) => (error ? reject(error) : resolve());

              let server: http.Server = createServer(null, function (req: TestRequest, res: TestResponse) {
                req.session.cookie.expires = null;
                res.end();
              });

              request(server)
                .get('/')
                .expect(shouldSetCookieWithoutAttribute('connect.sid', 'Expires'))
                .expect(200, done);
            });
          });

          it('should not reset cookie', function () {
            return new Promise<void>((resolve, reject) => {
              const done = (error?: unknown) => (error ? reject(error) : resolve());

              let server: http.Server = createServer(null, function (req: TestRequest, res: TestResponse) {
                req.session.cookie.expires = null;
                res.end();
              });

              request(server)
                .get('/')
                .expect(shouldSetCookieWithoutAttribute('connect.sid', 'Expires'))
                .expect(200, function (err, res) {
                  if (err) return done(err);
                  request(server)
                    .get('/')
                    .set('Cookie', cookie(res))
                    .expect(shouldNotHaveHeader('Set-Cookie'))
                    .expect(200, done);
                });
            });
          });

          it('should not reset cookie when modified', function () {
            return new Promise<void>((resolve, reject) => {
              const done = (error?: unknown) => (error ? reject(error) : resolve());

              let server: http.Server = createServer(null, function (req: TestRequest, res: TestResponse) {
                req.session.cookie.expires = null;
                req.session.hit = (req.session.hit || 0) + 1;
                res.end();
              });

              request(server)
                .get('/')
                .expect(shouldSetCookieWithoutAttribute('connect.sid', 'Expires'))
                .expect(200, function (err, res) {
                  if (err) return done(err);
                  request(server)
                    .get('/')
                    .set('Cookie', cookie(res))
                    .expect(shouldNotHaveHeader('Set-Cookie'))
                    .expect(200, done);
                });
            });
          });
        });
      });

      describe('.partitioned', function () {
        describe('by default', function () {
          it('should not set partitioned attribute', function () {
            return new Promise<void>((resolve, reject) => {
              const done = (error?: unknown) => (error ? reject(error) : resolve());

              let server: http.Server = createServer();

              request(server)
                .get('/')
                .expect(shouldSetCookieWithoutAttribute('connect.sid', 'Partitioned'))
                .expect(200, done);
            });
          });
        });

        describe('when "false"', function () {
          it('should not set partitioned attribute', function () {
            return new Promise<void>((resolve, reject) => {
              const done = (error?: unknown) => (error ? reject(error) : resolve());

              let server: http.Server = createServer({
                cookie: { partitioned: false },
              });

              request(server)
                .get('/')
                .expect(shouldSetCookieWithoutAttribute('connect.sid', 'Partitioned'))
                .expect(200, done);
            });
          });
        });

        describe('when "true"', function () {
          it('should set partitioned attribute', function () {
            return new Promise<void>((resolve, reject) => {
              const done = (error?: unknown) => (error ? reject(error) : resolve());

              let server: http.Server = createServer({
                cookie: { partitioned: true },
              });

              request(server)
                .get('/')
                .expect(shouldSetCookieWithAttribute('connect.sid', 'Partitioned'))
                .expect(200, done);
            });
          });
        });
      });
    });
  });

  describe('synchronous store', function () {
    it('should respond correctly on save', function () {
      return new Promise<void>((resolve, reject) => {
        const done = (error?: unknown) => (error ? reject(error) : resolve());

        let store = new SyncStore();
        let server: http.Server = createServer({ store: store }, function (req: TestRequest, res: TestResponse) {
          req.session.count = req.session.count || 0;
          req.session.count++;
          res.end('hits: ' + req.session.count);
        });

        request(server).get('/').expect(200, 'hits: 1', done);
      });
    });

    it('should respond correctly on destroy', function () {
      return new Promise<void>((resolve, reject) => {
        const done = (error?: unknown) => (error ? reject(error) : resolve());

        let store = new SyncStore();
        let server: http.Server = createServer(
          { store: store, unset: 'destroy' },
          function (req: TestRequest, res: TestResponse) {
            req.session.count = req.session.count || 0;
            let count = ++req.session.count;
            if (req.session.count > 1) {
              req.session = null;
              res.write('destroyed\n');
            }
            res.end('hits: ' + count);
          },
        );

        request(server)
          .get('/')
          .expect(200, 'hits: 1', function (err, res) {
            if (err) return done(err);
            request(server).get('/').set('Cookie', cookie(res)).expect(200, 'destroyed\nhits: 2', done);
          });
      });
    });
  });

  describe('cookieParser()', function () {
    it('should ignore req.cookies when the header has no session cookie', function () {
      return new Promise<void>((resolve, reject) => {
        const done = (error?: unknown) => (error ? reject(error) : resolve());

        let app: Handler = express()
          .use(cookieParser())
          .use(function (req: TestRequest, res: TestResponse, next) {
            req.headers.cookie = 'foo=bar';
            next();
          })
          .use(createSession())
          .use(function (req: TestRequest, res: TestResponse, next) {
            req.session.count = req.session.count || 0;
            req.session.count++;
            res.end(req.session.count.toString());
          });

        request(app)
          .get('/')
          .expect(200, '1', function (err, res) {
            if (err) return done(err);
            request(app).get('/').set('Cookie', cookie(res)).expect(200, '1', done);
          });
      });
    });

    it('should ignore req.cookies for a custom cookie name', function () {
      return new Promise<void>((resolve, reject) => {
        const done = (error?: unknown) => (error ? reject(error) : resolve());

        let app: Handler = express()
          .use(cookieParser())
          .use(function (req: TestRequest, res: TestResponse, next) {
            req.headers.cookie = 'foo=bar';
            next();
          })
          .use(createSession({ name: 'sessid' }))
          .use(function (req: TestRequest, res: TestResponse, next) {
            req.session.count = req.session.count || 0;
            req.session.count++;
            res.end(req.session.count.toString());
          });

        request(app)
          .get('/')
          .expect(200, '1', function (err, res) {
            if (err) return done(err);
            request(app)
              .get('/')
              .set('Cookie', 'sessid=' + sid(res))
              .expect(200, '1', done);
          });
      });
    });

    it('should ignore req.signedCookies when the header has no session cookie', function () {
      return new Promise<void>((resolve, reject) => {
        const done = (error?: unknown) => (error ? reject(error) : resolve());

        let app: Handler = express()
          .use(cookieParser('keyboard cat'))
          .use(function (req: TestRequest, res: TestResponse, next) {
            delete req.headers.cookie;
            next();
          })
          .use(createSession())
          .use(function (req: TestRequest, res: TestResponse, next) {
            req.session.count = req.session.count || 0;
            req.session.count++;
            res.end(req.session.count.toString());
          });

        request(app)
          .get('/')
          .expect(200, '1', function (err, res) {
            if (err) return done(err);
            request(app).get('/').set('Cookie', cookie(res)).expect(200, '1', done);
          });
      });
    });
  });
});

function cookie(res: request.Response): string {
  let setCookie = res.headers['set-cookie'];
  return (setCookie && setCookie[0])!;
}

function createServer(
  options?: TestOptions | Handler | null,
  respond?: Handler | TestOptions | null,
  finalRespond?: Handler,
): http.Server {
  const server = http.createServer();
  if (typeof options === 'function') {
    server.on('request', options);
    return server.on('request', createRequestListener(respond as TestOptions | null, finalRespond));
  }
  return server.on('request', createRequestListener(options, respond as Handler | undefined));
}

function createRequestListener(opts?: TestOptions | null, fn?: Handler): Handler {
  const middleware = createSession(opts);
  const respond = fn || end;
  return function onRequest(this: http.Server, req: TestRequest, res: TestResponse) {
    middleware(req, res, (error) => {
      const err = error as (Error & { status?: number }) | undefined;
      if (err && !res.headersSent) {
        res.statusCode = err.status || 500;
        res.end(err.message);
        return;
      }
      if (err) {
        this.emit('error', err);
        return;
      }
      respond(req, res);
    });
  };
}

function createSession(opts?: TestOptions | null): SessionMiddleware {
  const options = opts || {};
  if (!('cookie' in options)) options.cookie = { maxAge: 60 * 1000 };
  return session(options as SessionOptions);
}

function end(req: TestRequest, res: TestResponse): void {
  res.end();
}

function expires(res: request.Response) {
  let header = cookie(res);
  return header && utils.parseSetCookie(header).expires;
}

function mountAt(path: string): Handler {
  return function (req: TestRequest, res: TestResponse) {
    if (req.url!.indexOf(path) === 0) {
      req.originalUrl = req.url;
      req.url = req.url!.slice(path.length);
    }
  };
}

function shouldNotHaveHeader(header: string): ResponseAssertion {
  return function (res) {
    assert.ok(!(header.toLowerCase() in res.headers), 'should not have ' + header + ' header');
  };
}

function shouldNotSetSessionInStore(store: Store) {
  let _set = store.set;
  let count = 0;

  store.set = function set(...args: Parameters<Store['set']>) {
    count++;
    return _set.apply(this, args);
  };

  return function () {
    assert.ok(count === 0, 'should not set session in store');
  };
}

function shouldSetCookie(name: string): ResponseAssertion {
  return function (res) {
    let header = cookie(res);
    let data = utils.parseSetCookie(header);
    assert.ok(header, 'should have a cookie header');
    assert.strictEqual(data.name, name, 'should set cookie ' + name);
  };
}

function shouldSetCookieToDifferentSessionId(id: string): ResponseAssertion {
  return function (res) {
    assert.notStrictEqual(sid(res), id);
  };
}

function shouldSetCookieToExpireIn(name: string, delta: number): ResponseAssertion {
  return function (res) {
    let header = cookie(res);
    let data = utils.parseSetCookie(header);
    assert.ok(header, 'should have a cookie header');
    assert.strictEqual(data.name, name, 'should set cookie ' + name);
    assert.ok('expires' in data, 'should set cookie with attribute Expires');
    assert.ok('date' in res.headers, 'should have a date header');
    assert.strictEqual(
      Date.parse(data.expires as string) - Date.parse(res.headers.date),
      delta,
      'should set cookie ' + name + ' to expire in ' + delta + ' ms',
    );
  };
}

function shouldSetCookieToValue(name: string, val: string): ResponseAssertion {
  return function (res) {
    let header = cookie(res);
    let data = utils.parseSetCookie(header);
    assert.ok(header, 'should have a cookie header');
    assert.strictEqual(data.name, name, 'should set cookie ' + name);
    assert.strictEqual(data.value, val, 'should set cookie ' + name + ' to ' + val);
  };
}

function shouldSetCookieWithAttribute(name: string, attrib: string): ResponseAssertion {
  return function (res) {
    let header = cookie(res);
    let data = utils.parseSetCookie(header);
    assert.ok(header, 'should have a cookie header');
    assert.strictEqual(data.name, name, 'should set cookie ' + name);
    assert.ok(attrib.toLowerCase() in data, 'should set cookie with attribute ' + attrib);
  };
}

function shouldSetCookieWithAttributeAndValue(
  name: string,
  attrib: string,
  value: string | boolean,
): ResponseAssertion {
  return function (res) {
    let header = cookie(res);
    let data = utils.parseSetCookie(header);
    assert.ok(header, 'should have a cookie header');
    assert.strictEqual(data.name, name, 'should set cookie ' + name);
    assert.ok(attrib.toLowerCase() in data, 'should set cookie with attribute ' + attrib);
    assert.strictEqual(
      data[attrib.toLowerCase()],
      value,
      'should set cookie with attribute ' + attrib + ' set to ' + value,
    );
  };
}

function shouldSetCookieWithoutAttribute(name: string, attrib: string): ResponseAssertion {
  return function (res) {
    let header = cookie(res);
    let data = utils.parseSetCookie(header);
    assert.ok(header, 'should have a cookie header');
    assert.strictEqual(data.name, name, 'should set cookie ' + name);
    assert.ok(!(attrib.toLowerCase() in data), 'should set cookie without attribute ' + attrib);
  };
}

function shouldSetSessionInStore(store: Store, delay?: number) {
  let _set = store.set;
  let count = 0;

  store.set = function set(...args: Parameters<Store['set']>) {
    count++;

    if (!delay) {
      return _set.apply(this, args);
    }

    setTimeout(() => _set.apply(this, args), delay);
  };

  return function () {
    assert.ok(count === 1, 'should set session in store');
  };
}

function sid(res: request.Response): string {
  let header = cookie(res);
  let data = utils.parseSetCookie(header);
  return decodeURIComponent(data.value);
}
