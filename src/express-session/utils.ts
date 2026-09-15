import crypto, { randomBytes } from 'node:crypto';
import type { TLSSocket } from 'node:tls';
import { parse, serialize } from 'cookie';
import type { SerializeOptions } from 'cookie';
import type { ServerResponse } from 'node:http';
import { debuglog } from 'node:util';
import type { HttpSessionRequest } from './index';
import type { CookieData } from './session/cookie';
import type { SessionData } from './session/store';

const debug = debuglog('express-session');

/**
 * Generate a session ID for a new session.
 *
 * @return {String}
 * @private
 */

export function generateSessionId() {
  return randomBytes(24).toString('base64url');
}

/**
 * Get the session ID cookie from request.
 *
 * @return {string}
 * @private
 */

export function getcookie(req: HttpSessionRequest, name: string) {
  const header = req.headers.cookie;
  return header ? parse(header)[name] || undefined : undefined;
}

/**
 * Hash the given `sess` object omitting changes to `.cookie`.
 *
 * @param {Object} sess
 * @return {String}
 * @private
 */

export function hash(sess: SessionData) {
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

export function issecure(req: HttpSessionRequest, trustProxy?: boolean) {
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

export function setcookie(res: ServerResponse, name: string, val: string, options: CookieData) {
  const data = serialize(name, val, options as SerializeOptions);

  debug('set-cookie %s', data);

  const prev = res.getHeader('Set-Cookie') || [];
  const header = Array.isArray(prev) ? prev.concat(data) : [String(prev), data];

  res.setHeader('Set-Cookie', header);
}
