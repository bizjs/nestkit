/*!
 * Connect - session - Cookie
 * Copyright(c) 2010 Sencha Inc.
 * Copyright(c) 2011 TJ Holowaychuk
 * MIT Licensed
 */

import { serialize } from 'cookie';
import type { SerializeOptions } from 'cookie';

type Expiration = Date | string | null | false | undefined;
type MaxAge = number | string | null | false | undefined;

export interface CookieOptions {
  path?: string;
  domain?: string;
  httpOnly?: boolean;
  secure?: boolean | 'auto';
  sameSite?: boolean | 'lax' | 'strict' | 'none' | 'auto';
  partitioned?: boolean;
  priority?: 'low' | 'medium' | 'high';
  expires?: Expiration;
  maxAge?: number | null | false;
  originalMaxAge?: MaxAge;
  [key: string]: unknown;
}

export interface CookieData {
  originalMaxAge: MaxAge;
  partitioned?: boolean;
  priority?: CookieOptions['priority'];
  expires: Expiration;
  secure?: CookieOptions['secure'];
  httpOnly?: boolean;
  domain?: string;
  path?: string;
  sameSite?: CookieOptions['sameSite'];
}

export class Cookie {
  declare path: string;
  declare domain: string | undefined;
  declare httpOnly: boolean;
  declare secure: CookieOptions['secure'];
  declare sameSite: CookieOptions['sameSite'];
  declare partitioned: boolean | undefined;
  declare priority: CookieOptions['priority'];
  declare originalMaxAge: MaxAge;
  declare private _expires: Expiration;

  constructor(options?: CookieOptions | null) {
    this.path = '/';
    this.maxAge = null;
    this.httpOnly = true;

    if (options) {
      if (typeof options !== 'object') {
        throw new TypeError('argument options must be a object');
      }
      for (const key in options) {
        if (key !== 'data') {
          // Preserve option order and invoke setters, including inherited enumerable options.
          if (!Reflect.set(this, key, options[key])) {
            throw new TypeError(`Cannot assign cookie option ${key}`);
          }
        }
      }
    }

    if (this.originalMaxAge === undefined || this.originalMaxAge === null) {
      this.originalMaxAge = this.maxAge;
    }
  }

  set expires(date: Expiration) {
    this._expires = date;
    this.originalMaxAge = this.maxAge;
  }

  get expires(): Expiration {
    return this._expires;
  }

  set maxAge(ms: number | null | false | undefined) {
    this.expires = typeof ms === 'number' ? new Date(Date.now() + ms) : ms;
  }

  get maxAge(): MaxAge {
    return this.expires instanceof Date
      ? this.expires.valueOf() - Date.now()
      : this.expires;
  }

  get data(): CookieData {
    return {
      originalMaxAge: this.originalMaxAge,
      partitioned: this.partitioned,
      priority: this.priority,
      expires: this._expires,
      secure: this.secure,
      httpOnly: this.httpOnly,
      domain: this.domain,
      path: this.path,
      sameSite: this.sameSite,
    };
  }

  serialize(name: string, value: string): string {
    // Keep upstream validation: Store restores dates and middleware resolves 'auto'.
    return serialize(name, value, this.data as SerializeOptions);
  }

  toJSON(): CookieData {
    return this.data;
  }
}
