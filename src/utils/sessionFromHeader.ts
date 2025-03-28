import * as cookie from 'cookie';
import { sign } from 'cookie-signature';

export function syncSessionIdFromHeader(options: { cookieName?: string; headerName?: string }) {
  const cookieName = options.cookieName || 'connect.sid';
  const headerName = options.headerName || 'connect.sid';
  return (req: any, res: any, next: Function) => {
    const signedSessionId = req.headers[headerName] as string;

    // If get signed sessionID from header, set it to cookie
    if (signedSessionId) {
      const header = req.headers.cookie;
      const cookies = header ? cookie.parse(header) : {};
      cookies[cookieName] = signedSessionId;
      // set to cookie
      req.headers.cookie = Object.entries(cookies)
        .map(([key, value]) => {
          return cookie.serialize(key, value as string) as string;
        })
        .join(';');
    }

    next();
  };
}

export function getSignedSessionId(id: string, secret: string) {
  const signed = sign(id, secret);
  return `s:${signed}`;
}
