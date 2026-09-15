import { describe, it } from 'vitest';

import assert from 'node:assert';
import type { CookieOptions } from '../../src/express-session/session/cookie.ts';
import { Cookie } from '../../src/express-session/session/cookie.ts';
describe('new Cookie()', function () {
  it('should create a new cookie object', function () {
    assert.strictEqual(typeof new Cookie(), 'object');
  });

  it('should default expires to null', function () {
    let cookie = new Cookie();
    assert.strictEqual(cookie.expires, null);
  });

  it('should default httpOnly to true', function () {
    let cookie = new Cookie();
    assert.strictEqual(cookie.httpOnly, true);
  });

  it('should default path to "/"', function () {
    let cookie = new Cookie();
    assert.strictEqual(cookie.path, '/');
  });

  it('should default maxAge to null', function () {
    let cookie = new Cookie();
    assert.strictEqual(cookie.maxAge as number, null);
  });

  describe('with options', function () {
    it('should create a new cookie object', function () {
      assert.strictEqual(typeof new Cookie({}), 'object');
    });

    it('should reject non-objects', function () {
      assert.throws(function () {
        new Cookie(42 as unknown as CookieOptions);
      }, /argument options/);
      assert.throws(function () {
        new Cookie('foo' as unknown as CookieOptions);
      }, /argument options/);
      assert.throws(function () {
        new Cookie(true as unknown as CookieOptions);
      }, /argument options/);
      assert.throws(function () {
        new Cookie(function () {} as unknown as CookieOptions);
      }, /argument options/);
    });

    it('should ignore "data" option', function () {
      let cookie = new Cookie({ data: { foo: 'bar' }, path: '/foo' });

      assert.strictEqual(typeof cookie, 'object');
      assert.strictEqual(typeof cookie.data, 'object');
      assert.strictEqual(cookie.data.path, '/foo');
      assert.notStrictEqual(Reflect.get(cookie.data, 'foo'), 'bar');
    });

    describe('expires', function () {
      it('should set expires', function () {
        let expires = new Date(Date.now() + 60000);
        let cookie = new Cookie({ expires: expires });

        assert.strictEqual(cookie.expires, expires);
      });

      it('should set maxAge', function () {
        let expires = new Date(Date.now() + 60000);
        let cookie = new Cookie({ expires: expires });

        assert.ok(expires.getTime() - Date.now() - 1000 <= (cookie.maxAge as number));
        assert.ok(expires.getTime() - Date.now() + 1000 >= (cookie.maxAge as number));
      });
    });

    describe('httpOnly', function () {
      it('should set httpOnly', function () {
        let cookie = new Cookie({ httpOnly: false });

        assert.strictEqual(cookie.httpOnly, false);
      });
    });

    describe('maxAge', function () {
      it('should set expires', function () {
        let maxAge = 60000;
        let cookie = new Cookie({ maxAge: maxAge });

        assert.ok((cookie.expires as Date).getTime() - Date.now() - 1000 <= maxAge);
        assert.ok((cookie.expires as Date).getTime() - Date.now() + 1000 >= maxAge);
      });

      it('should set maxAge', function () {
        let maxAge = 60000;
        let cookie = new Cookie({ maxAge: maxAge });

        assert.strictEqual(typeof (cookie.maxAge as number), 'number');
        assert.ok((cookie.maxAge as number) - 1000 <= maxAge);
        assert.ok((cookie.maxAge as number) + 1000 >= maxAge);
      });

      it('should accept a duration calculated from a Date', function () {
        let maxAge = new Date(Date.now() + 60000);
        let cookie = new Cookie({ maxAge: maxAge.getTime() - Date.now() });

        assert.ok(Math.abs((cookie.expires as Date).getTime() - maxAge.getTime()) < 1000);
        assert.ok(maxAge.getTime() - Date.now() - 1000 <= (cookie.maxAge as number));
        assert.ok(maxAge.getTime() - Date.now() + 1000 >= (cookie.maxAge as number));
      });
    });

    describe('partitioned', function () {
      it('should set partitioned', function () {
        let cookie = new Cookie({ partitioned: true });

        assert.strictEqual(cookie.partitioned, true);
      });
    });

    describe('path', function () {
      it('should set path', function () {
        let cookie = new Cookie({ path: '/foo' });

        assert.strictEqual(cookie.path, '/foo');
      });
    });

    describe('priority', function () {
      it('should set priority', function () {
        let cookie = new Cookie({ priority: 'high' });

        assert.strictEqual(cookie.priority, 'high');
      });
    });
  });
});
