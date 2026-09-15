import { Buffer } from 'node:buffer';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { debuglog } from 'node:util';
import onHeaders from 'on-headers';
import { generateSessionId, getcookie, getPathname, hash, issecure, setcookie } from './utils';
import { Cookie } from './session/cookie';
import type { CookieData, CookieOptions } from './session/cookie';
import { MemoryStore } from './session/memory';
import { Session } from './session/session';
import { Store } from './session/store';
import type { SessionData, SessionRequest, StoreCallback } from './session/store.ts';

export { Cookie, MemoryStore, Session, Store };
export type { CookieData, CookieOptions, SessionData, SessionRequest, StoreCallback };
/** Session methods and metadata combined with application fields. */
export type SessionInstance<T extends object = Record<string, unknown>> = Session & T;

export interface HttpSessionRequest extends IncomingMessage, SessionRequest {
  originalUrl?: string;
  secure?: boolean;
}

/** Session middleware configuration. */
export interface SessionOptions {
  /** false disables SID cookie transport; session.cookie remains expiry metadata. */
  cookie?: false | CookieOptions | ((request: HttpSessionRequest) => CookieOptions);
  /** Read an unsigned SID. When configured, Cookie is never used as a fallback. */
  getid?: (request: HttpSessionRequest) => string | null | undefined;
  /** Session ID cookie name. Defaults to 'connect.sid'. */
  name?: string;
  /** Trust X-Forwarded-Proto for HTTPS detection. When omitted, use req.secure. */
  proxy?: boolean;
  /** Save unmodified sessions back to the store. Defaults to true. */
  resave?: boolean;
  /** Refresh the session cookie on every response. Defaults to false. */
  rolling?: boolean;
  /** Save new, unmodified sessions to the store. Defaults to true. */
  saveUninitialized?: boolean;
  /** Session storage. Defaults to a new MemoryStore. */
  store?: Store;
  /** Keep or destroy stored data when req.session is unset. Defaults to 'keep'. */
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

export const expressSession = Object.assign(session, { Store, Cookie, Session, MemoryStore });

/**
 * Warning message for `MemoryStore` usage in production.
 * @private
 */

const warning =
  'Warning: connect.session() MemoryStore is not\n' +
  'designed for a production environment, as it will leak\n' +
  'memory, and will not scale past a single process.';

/** Create session middleware. */
export function session(options?: SessionOptions): SessionMiddleware {
  const opts = options || {};

  // get the cookie options
  const cookieEnabled = opts.cookie !== false;
  const cookieOptions = opts.cookie || {};

  // get the session cookie name
  const name = opts.name || 'connect.sid';

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

  if (opts.unset && opts.unset !== 'destroy' && opts.unset !== 'keep') {
    throw new TypeError('unset option must be "destroy" or "keep"');
  }

  // TODO: switch to "destroy" on next major
  const unsetDestroy = opts.unset === 'destroy';

  // notify user that this store is not
  // meant for a production environment
  /* istanbul ignore next: not tested */
  if (env === 'production' && store instanceof MemoryStore) {
    console.warn(warning);
  }

  // generates the new session
  store.generate = function (request) {
    const req = request as HttpSessionRequest;
    req.sessionID = generateSessionId();
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
      const originalPath = getPathname(req.originalUrl || req.url || '/');
      const resolvedCookieOptions = typeof cookieOptions === 'function' ? cookieOptions(req) : cookieOptions;
      if (originalPath.indexOf(resolvedCookieOptions.path || '/') !== 0) {
        debug('pathname mismatch');
        next();
        return;
      }
    }

    let originalHash: string | undefined;
    let originalId: string | undefined;
    let savedHash: string | undefined;
    let touched = false;

    // expose store
    req.sessionStore = store;

    let incomingId: string | undefined;
    try {
      incomingId = opts.getid ? opts.getid(req) || undefined : cookieEnabled ? getcookie(req, name) : undefined;
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
          setcookie(res, name, req.sessionID, req.session.cookie.data);
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
