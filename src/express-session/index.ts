/*!
 * express-session
 * Copyright(c) 2010 Sencha Inc.
 * Copyright(c) 2011 TJ Holowaychuk
 * Copyright(c) 2014-2015 Douglas Christopher Wilson
 * MIT Licensed
 */

import { Buffer } from 'node:buffer';
import crypto, { randomBytes } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { TLSSocket } from 'node:tls';
import { parse, serialize } from 'cookie';
import type { SerializeOptions } from 'cookie';
import { debuglog } from 'node:util';
import onHeaders from 'on-headers';
import signature from 'cookie-signature';
import { Cookie } from './session/cookie';
import type { CookieData, CookieOptions } from './session/cookie';
import { MemoryStore } from './session/memory';
import { Session } from './session/session';
import { Store } from './session/store';
import type { SessionData, SessionRequest, StoreCallback } from './session/store.ts';

export { Cookie, MemoryStore, Session, Store };
export type { CookieData, CookieOptions, SessionData, SessionRequest, StoreCallback };

export interface HttpSessionRequest extends IncomingMessage, SessionRequest {
  originalUrl?: string;
  secure?: boolean;
}

export interface SessionOptions {
  /** false disables SID cookie transport; session.cookie remains expiry metadata. */
  cookie?: false | CookieOptions | ((request: HttpSessionRequest) => CookieOptions);
  /** Read an unsigned SID. When configured, Cookie is never used as a fallback. */
  getid?: (request: HttpSessionRequest) => string | null | undefined;
  genid?: (request: HttpSessionRequest) => string;
  name?: string;
  key?: string;
  proxy?: boolean;
  resave?: boolean;
  rolling?: boolean;
  saveUninitialized?: boolean;
  secret?: string | string[];
  store?: Store;
  unset?: 'destroy' | 'keep';
}

export type NextFunction = (error?: unknown) => void;
export type SessionMiddleware = (request: IncomingMessage, response: ServerResponse, next: NextFunction) => void;

// Node's internal header hooks are used to save before ending the response.
type SessionResponse = ServerResponse & {
  _header: string | null;
  _implicitHeader(): void;
};

const debug = debuglog('express-session');
const env = process.env.NODE_ENV;
const defer = setImmediate;

export default Object.assign(session, { Store, Cookie, Session, MemoryStore });

/**
 * Warning message for `MemoryStore` usage in production.
 * @private
 */

const warning =
  'Warning: connect.session() MemoryStore is not\n' +
  'designed for a production environment, as it will leak\n' +
  'memory, and will not scale past a single process.';

/**
 * Setup session store with the given `options`.
 *
 * @param {Object} [options]
 * @param {Object|Function|false} [options.cookie] Cookie options or false to disable transport
 * @param {Function} [options.getid] Read a raw session ID from the request
 * @param {Function} [options.genid]
 * @param {String} [options.name=connect.sid] Session ID cookie name
 * @param {Boolean} [options.proxy]
 * @param {Boolean} [options.resave] Resave unmodified sessions back to the store
 * @param {Boolean} [options.rolling] Enable/disable rolling session expiration
 * @param {Boolean} [options.saveUninitialized] Save uninitialized sessions to the store
 * @param {String|Array} [options.secret] Secret for signing session ID
 * @param {Object} [options.store=MemoryStore] Session store
 * @param {String} [options.unset]
 * @return {Function} middleware
 * @public
 */

export function session(options?: SessionOptions): SessionMiddleware {
  const opts = options || {};

  // get the cookie options
  const cookieEnabled = opts.cookie !== false;
  const cookieOptions = opts.cookie || {};

  // get the session id generate function
  const generateId = opts.genid || generateSessionId;

  // get the session cookie name
  const name = opts.name || opts.key || 'connect.sid';

  // get the session store
  const store = opts.store || new MemoryStore();

  // get the trust proxy setting
  const trustProxy = opts.proxy;

  // get the resave session option
  const resaveSession = opts.resave ?? true;

  // get the rolling session option
  const rollingSessions = Boolean(opts.rolling);

  // get the save uninitialized session option
  const saveUninitializedSession = opts.saveUninitialized ?? true;

  // get the cookie signing secret
  const configuredSecret = opts.secret;
  const secret = configuredSecret
    ? Array.isArray(configuredSecret)
      ? configuredSecret
      : [configuredSecret]
    : undefined;

  if (typeof generateId !== 'function') {
    throw new TypeError('genid option must be a function');
  }

  if (opts.unset && opts.unset !== 'destroy' && opts.unset !== 'keep') {
    throw new TypeError('unset option must be "destroy" or "keep"');
  }

  // TODO: switch to "destroy" on next major
  const unsetDestroy = opts.unset === 'destroy';

  if (cookieEnabled && Array.isArray(secret) && secret.length === 0) {
    throw new TypeError('secret option array must contain one or more strings');
  }

  // notify user that this store is not
  // meant for a production environment
  /* istanbul ignore next: not tested */
  if (env === 'production' && store instanceof MemoryStore) {
    console.warn(warning);
  }

  // generates the new session
  store.generate = function (request) {
    const req = request as HttpSessionRequest;
    req.sessionID = generateId(req);
    req.session = new Session(req);
    const resolvedCookieOptions = typeof cookieOptions === 'function' ? cookieOptions(req) : cookieOptions;
    req.session.cookie = new Cookie(resolvedCookieOptions);

    const isSecure = issecure(req, trustProxy);

    if (resolvedCookieOptions.secure === 'auto') {
      req.session.cookie.secure = isSecure;
    }

    if (resolvedCookieOptions.sameSite === 'auto') {
      req.session.cookie.sameSite = isSecure ? 'none' : 'lax';
    }
  };

  const storeImplementsTouch = typeof store.touch === 'function';

  // register event listeners for the store to track readiness
  let storeReady = true;
  store.on('disconnect', function ondisconnect() {
    storeReady = false;
  });
  store.on('connect', function onconnect() {
    storeReady = true;
  });

  return function session(request, response, next) {
    const req = request as HttpSessionRequest;
    const res = response as SessionResponse;
    // self-awareness
    if (req.session) {
      next();
      return;
    }

    // Handle connection as if there is no session if
    // the store has temporarily disconnected etc
    if (!storeReady) {
      debug('store is disconnected');
      next();
      return;
    }

    if (cookieEnabled) {
      // pathname mismatch
      const originalUrl = req.originalUrl || req.url || '/';
      let originalPath: string;
      try {
        // A fixed base needs no Host header; leading // remains an HTTP request path.
        const base = 'http://localhost';
        originalPath = new URL(originalUrl.startsWith('/') ? base + originalUrl : originalUrl, base).pathname || '/';
      } catch (error) {
        next(error);
        return;
      }
      const resolvedCookieOptions = typeof cookieOptions === 'function' ? cookieOptions(req) : cookieOptions;
      if (originalPath.indexOf(resolvedCookieOptions.path || '/') !== 0) {
        debug('pathname mismatch');
        next();
        return;
      }
    }

    // ensure a secret is available or bail
    if (cookieEnabled && !secret) {
      next(new Error('secret option required for sessions'));
      return;
    }

    const secrets = secret || [];

    let originalHash: string | undefined;
    let originalId: string | undefined;
    let savedHash: string | undefined;
    let touched = false;

    // expose store
    req.sessionStore = store;

    let incomingId: string | undefined;
    try {
      incomingId = opts.getid
        ? opts.getid(req) || undefined
        : cookieEnabled
          ? getcookie(req, name, secrets)
          : undefined;
    } catch (error) {
      next(error);
      return;
    }
    req.sessionID = incomingId!;

    if (cookieEnabled) {
      // set-cookie
      onHeaders(res, function () {
        if (!req.session) {
          debug('no session');
          return;
        }

        if (!shouldSetCookie(req)) {
          return;
        }

        // only send secure cookies via https
        if (req.session.cookie.secure && !issecure(req, trustProxy)) {
          debug('not secured');
          return;
        }

        if (!touched) {
          // touch session
          req.session.touch();
          touched = true;
        }

        // set cookie
        try {
          setcookie(res, name, req.sessionID, secrets[0], req.session.cookie.data);
        } catch (err) {
          defer(next, err);
        }
      });
    }

    // proxy end() to commit the session
    const _end = res.end as (
      this: ServerResponse,
      chunk?: string | Buffer,
      encoding?: BufferEncoding,
    ) => ServerResponse;
    const _write = res.write as (this: ServerResponse, chunk: string | Buffer, encoding?: BufferEncoding) => boolean;
    let ended = false;
    res.end = function end(chunk?: string | Buffer, encoding?: BufferEncoding) {
      if (ended) {
        return false;
      }

      ended = true;

      let ret: ServerResponse | boolean | undefined;
      let sync = true;

      function writeend() {
        if (sync) {
          ret = _end.call(res, chunk, encoding);
          sync = false;
          return;
        }

        _end.call(res);
      }

      function writetop() {
        if (!sync) {
          return ret;
        }

        if (!res._header) {
          res._implicitHeader();
        }

        if (chunk == null) {
          ret = true;
          return ret;
        }

        const contentLength = Number(res.getHeader('Content-Length'));

        if (!isNaN(contentLength) && contentLength > 0) {
          // measure chunk
          chunk = !Buffer.isBuffer(chunk) ? Buffer.from(chunk as string, encoding) : chunk;
          encoding = undefined;

          if (chunk.length !== 0) {
            debug('split response');
            ret = _write.call(res, chunk.slice(0, chunk.length - 1));
            chunk = chunk.slice(chunk.length - 1, chunk.length);
            return ret;
          }
        }

        ret = _write.call(res, chunk, encoding);
        sync = false;

        return ret;
      }

      if (shouldDestroy(req)) {
        // destroy session
        debug('destroying');
        store.destroy(req.sessionID, function ondestroy(err) {
          if (err) {
            defer(next, err);
          }

          debug('destroyed');
          writeend();
        });

        return writetop();
      }

      // no session to save
      if (!req.session) {
        debug('no session');
        return _end.call(res, chunk, encoding);
      }

      if (!touched) {
        // touch session
        req.session.touch();
        touched = true;
      }

      if (shouldSave(req)) {
        req.session.save(function onsave(err) {
          if (err) {
            defer(next, err);
          }

          writeend();
        });

        return writetop();
      } else if (storeImplementsTouch && shouldTouch(req)) {
        // store implements touch method
        debug('touching');
        store.touch!(req.sessionID, req.session, function ontouch(err) {
          if (err) {
            defer(next, err);
          }

          debug('touched');
          writeend();
        });

        return writetop();
      }

      return _end.call(res, chunk, encoding);
    } as ServerResponse['end'];

    // generate the session
    function generate() {
      store.generate(req);
      originalId = req.sessionID;
      originalHash = hash(req.session!);
      wrapmethods(req.session!);
    }

    // inflate the session
    function inflate(req: HttpSessionRequest, sess: SessionData) {
      store.createSession(req, sess);
      originalId = req.sessionID;
      originalHash = hash(sess);

      if (!resaveSession) {
        savedHash = originalHash;
      }

      wrapmethods(req.session!);
    }

    function rewrapmethods(sess: Session, callback: StoreCallback) {
      return function (this: unknown, ...args: Parameters<StoreCallback>) {
        if (req.session !== sess) {
          wrapmethods(req.session!);
        }

        callback.apply(this, args);
      };
    }

    // wrap session methods
    function wrapmethods(sess: Session) {
      const _reload = sess.reload;
      const _save = sess.save;

      function reload(this: Session, callback: StoreCallback) {
        debug('reloading %s', this.id);
        _reload.call(this, rewrapmethods(this, callback));
      }

      function save(this: Session, ...args: Parameters<Session['save']>) {
        debug('saving %s', this.id);
        savedHash = hash(this);
        _save.apply(this, args);
      }

      Object.defineProperty(sess, 'reload', {
        configurable: true,
        enumerable: false,
        value: reload,
        writable: true,
      });

      Object.defineProperty(sess, 'save', {
        configurable: true,
        enumerable: false,
        value: save,
        writable: true,
      });
    }

    // check if session has been modified
    function isModified(sess: Session) {
      return originalId !== sess.id || originalHash !== hash(sess);
    }

    // check if session has been saved
    function isSaved(sess: Session) {
      return originalId === sess.id && savedHash === hash(sess);
    }

    // determine if session should be destroyed
    function shouldDestroy(req: HttpSessionRequest) {
      return req.sessionID && unsetDestroy && req.session == null;
    }

    // determine if session should be saved to store
    function shouldSave(req: HttpSessionRequest) {
      // cannot set cookie without a session ID
      if (typeof req.sessionID !== 'string') {
        debug('session ignored because of bogus req.sessionID %o', req.sessionID);
        return false;
      }

      return !saveUninitializedSession && !savedHash && incomingId !== req.sessionID
        ? isModified(req.session!)
        : !isSaved(req.session!);
    }

    // determine if session should be touched
    function shouldTouch(req: HttpSessionRequest) {
      // cannot set cookie without a session ID
      if (typeof req.sessionID !== 'string') {
        debug('session ignored because of bogus req.sessionID %o', req.sessionID);
        return false;
      }

      return incomingId === req.sessionID && !shouldSave(req);
    }

    // determine if cookie should be set on response
    function shouldSetCookie(req: HttpSessionRequest) {
      // cannot set cookie without a session ID
      if (typeof req.sessionID !== 'string') {
        return false;
      }

      return incomingId !== req.sessionID
        ? saveUninitializedSession || isModified(req.session!)
        : rollingSessions || (req.session!.cookie.expires != null && isModified(req.session!));
    }

    // generate a session if the selected source does not provide a sessionID
    if (!req.sessionID) {
      debug('no SID sent, generating session');
      generate();
      next();
      return;
    }

    // generate the session object
    debug('fetching %s', req.sessionID);
    store.get(req.sessionID, function (err, sess) {
      // error handling
      if (err && (err as NodeJS.ErrnoException).code !== 'ENOENT') {
        debug('error %j', err);
        next(err);
        return;
      }

      try {
        if (err || !sess) {
          debug('no session found');
          generate();
        } else {
          debug('session found');
          inflate(req, sess);
        }
      } catch (e) {
        next(e);
        return;
      }

      next();
    });
  };
}

/**
 * Generate a session ID for a new session.
 *
 * @return {String}
 * @private
 */

function generateSessionId() {
  return randomBytes(24).toString('base64url');
}

/**
 * Get the session ID cookie from request.
 *
 * @return {string}
 * @private
 */

function getcookie(req: HttpSessionRequest, name: string, secrets: string[]) {
  const header = req.headers.cookie;
  let raw: string | undefined;
  let val: string | false | undefined;

  // read from cookie header
  if (header) {
    const cookies = parse(header);

    raw = cookies[name];

    if (raw) {
      if (raw.substr(0, 2) === 's:') {
        val = unsigncookie(raw.slice(2), secrets);

        if (val === false) {
          debug('cookie signature invalid');
          val = undefined;
        }
      } else {
        debug('cookie unsigned');
      }
    }
  }

  return val || undefined;
}

/**
 * Hash the given `sess` object omitting changes to `.cookie`.
 *
 * @param {Object} sess
 * @return {String}
 * @private
 */

function hash(sess: SessionData) {
  // serialize
  const str = JSON.stringify(sess, function (key, val) {
    // ignore sess.cookie property
    if (this === sess && key === 'cookie') {
      return;
    }

    return val;
  });

  // hash
  return crypto.createHash('sha1').update(str, 'utf8').digest('hex');
}

/**
 * Determine if request is secure.
 *
 * @param {Object} req
 * @param {Boolean} [trustProxy]
 * @return {Boolean}
 * @private
 */

function issecure(req: HttpSessionRequest, trustProxy?: boolean) {
  // socket is https server
  if (req.socket && (req.socket as TLSSocket).encrypted) {
    return true;
  }

  // do not trust proxy
  if (trustProxy === false) {
    return false;
  }

  // no explicit trust; try req.secure from express
  if (trustProxy !== true) {
    return req.secure === true;
  }

  // read the proto from x-forwarded-proto header
  const header = (req.headers['x-forwarded-proto'] as string | undefined) || '';
  const index = header.indexOf(',');
  const proto = index !== -1 ? header.substr(0, index).toLowerCase().trim() : header.toLowerCase().trim();

  return proto === 'https';
}

/**
 * Set cookie on response.
 *
 * @private
 */

function setcookie(res: ServerResponse, name: string, val: string, secret: string, options: CookieData) {
  const signed = 's:' + signature.sign(val, secret);
  const data = serialize(name, signed, options as SerializeOptions);

  debug('set-cookie %s', data);

  const prev = res.getHeader('Set-Cookie') || [];
  const header = Array.isArray(prev) ? prev.concat(data) : [String(prev), data];

  res.setHeader('Set-Cookie', header);
}

/**
 * Verify and decode the given `val` with `secrets`.
 *
 * @param {String} val
 * @param {Array} secrets
 * @returns {String|Boolean}
 * @private
 */
function unsigncookie(val: string, secrets: string[]) {
  for (let i = 0; i < secrets.length; i++) {
    const result = signature.unsign(val, secrets[i]);

    if (result !== false) {
      return result;
    }
  }

  return false;
}
