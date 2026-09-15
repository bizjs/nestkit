/*!
 * Connect - session - Store
 * Copyright(c) 2010 Sencha Inc.
 * Copyright(c) 2011 TJ Holowaychuk
 * MIT Licensed
 */

import { EventEmitter } from 'node:events';
import { Cookie } from './cookie';
import type { CookieOptions } from './cookie.ts';
import { Session } from './session';

export type StoreCallback = (error?: unknown) => void;

export interface SessionData {
  cookie: CookieOptions | Cookie;
  [key: string]: unknown;
}

export interface SessionRequest {
  sessionID: string;
  sessionStore: Store;
  session?: Session;
}

export interface Store {
  touch?(id: string, data: SessionData, callback?: StoreCallback): void;
}

export abstract class Store extends EventEmitter {
  // Installed by the session middleware for the configured generator and cookie options.
  declare generate: (request: SessionRequest) => void;

  abstract get(
    id: string,
    callback: (error?: unknown, data?: SessionData | null) => void,
  ): void;

  abstract set(id: string, data: SessionData, callback?: StoreCallback): void;
  abstract destroy(id: string, callback?: StoreCallback): void;

  regenerate(request: SessionRequest, callback: StoreCallback): void {
    this.destroy(request.sessionID, (error) => {
      this.generate(request);
      callback(error);
    });
  }

  load(
    id: string,
    callback: (error?: unknown, session?: Session) => void,
  ): void {
    this.get(id, (error, data) => {
      if (error) return callback(error);
      if (!data) return callback();
      const request: SessionRequest = { sessionID: id, sessionStore: this };
      callback(null, this.createSession(request, data));
    });
  }

  createSession(request: SessionRequest, data: SessionData): Session {
    const expires = data.cookie.expires;
    const originalMaxAge = data.cookie.originalMaxAge;
    const cookie = new Cookie(data.cookie as CookieOptions);
    data.cookie = cookie;
    if (typeof expires === 'string') {
      cookie.expires = new Date(expires);
    }
    cookie.originalMaxAge = originalMaxAge;
    request.session = new Session(request, data);
    return request.session;
  }
}
