import type { Cookie, CookieOptions } from './cookie';
import type { SessionData, SessionRequest, StoreCallback } from './store';

export class Session {
  declare readonly req: SessionRequest;
  declare readonly id: string;
  declare cookie: Cookie;
  [key: string]: unknown;

  constructor(request: SessionRequest, data?: SessionData | null) {
    // Keep request and SID read-only and out of serialized session data.
    Object.defineProperty(this, 'req', { value: request });
    Object.defineProperty(this, 'id', { value: request.sessionID });

    if (data) {
      for (const key in data) {
        if (!(key in this)) this[key] = data[key];
      }
    }
  }

  touch(): this {
    return this.resetMaxAge();
  }

  resetMaxAge(): this {
    this.cookie.maxAge = this.cookie.originalMaxAge as CookieOptions['maxAge'];
    return this;
  }

  save(callback?: StoreCallback): this {
    this.req.sessionStore.set(this.id, this, callback || (() => {}));
    return this;
  }

  reload(callback: StoreCallback): this {
    const request = this.req;
    const store = request.sessionStore;
    store.get(this.id, (error, data) => {
      if (error) return callback(error);
      if (!data) return callback(new Error('failed to load session'));
      store.createSession(request, data);
      callback();
    });
    return this;
  }

  destroy(callback?: StoreCallback): this {
    delete this.req.session;
    this.req.sessionStore.destroy(this.id, callback);
    return this;
  }

  regenerate(callback: StoreCallback): this {
    this.req.sessionStore.regenerate(this.req, callback);
    return this;
  }
}
