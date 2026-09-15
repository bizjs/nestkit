import { describe, it, expect, vi } from 'vitest';
import { parse } from 'cookie';
import { getSignedSessionId, syncSessionIdFromHeader } from '../../src';

describe('syncSessionIdFromHeader', () => {
  it.each(['X-Session-Id', 'X-SESSION-ID', 'x-session-id'])('accepts configured header name %s', (headerName) => {
    const sessionId = getSignedSessionId('session-id', 'test-secret');
    const req = { headers: { 'x-session-id': sessionId, cookie: 'theme=dark; CustomSid=old' } };
    const next = vi.fn();

    syncSessionIdFromHeader({ headerName, cookieName: 'CustomSid' })(req, {}, next);

    expect(parse(req.headers.cookie)).toEqual({ theme: 'dark', CustomSid: sessionId });
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('keeps the default header and cookie names', () => {
    const req: { headers: Record<string, string> } = { headers: { 'connect.sid': 'session-id' } };
    const next = vi.fn();

    syncSessionIdFromHeader({})(req, {}, next);

    expect(parse(req.headers.cookie)).toEqual({ 'connect.sid': 'session-id' });
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('preserves existing cookies when the session header is missing', () => {
    const req = { headers: { cookie: 'theme=dark; connect.sid=existing' } };
    const next = vi.fn();

    syncSessionIdFromHeader({ headerName: 'X-Session-Id' })(req, {}, next);

    expect(req.headers.cookie).toBe('theme=dark; connect.sid=existing');
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('does not create a cookie header when the session header is absent', () => {
    const req = { headers: {} as Record<string, string> };
    const next = vi.fn();

    syncSessionIdFromHeader({})(req, {}, next);

    expect(req.headers).not.toHaveProperty('cookie');
    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith();
  });

  it('ignores an empty session header without rewriting existing cookies', () => {
    const req = { headers: { 'connect.sid': '', cookie: 'theme=dark; connect.sid=existing' } };
    const next = vi.fn();

    syncSessionIdFromHeader({})(req, {}, next);

    expect(req.headers.cookie).toBe('theme=dark; connect.sid=existing');
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('encodes the header value as a single cookie and preserves encoded cookie values', () => {
    const sessionId = 's:session/value+signature=; injected=1%';
    const req = {
      headers: {
        'x-session-id': sessionId,
        cookie: 'theme=dark; label=hello%20world%3Bvalue%3D1',
      },
    };
    const next = vi.fn();

    syncSessionIdFromHeader({ headerName: 'X-Session-Id' })(req, {}, next);

    expect(parse(req.headers.cookie)).toEqual({
      theme: 'dark',
      label: 'hello world;value=1',
      'connect.sid': sessionId,
    });
    expect(req.headers.cookie).toContain(`connect.sid=${encodeURIComponent(sessionId)}`);
    expect(req.headers.cookie).not.toContain('; injected=1');
    expect(req.headers['x-session-id']).toBe(sessionId);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('replaces only the configured cookie and remains stable on repeated calls', () => {
    const req = {
      headers: {
        'x-session-id': 'new-id',
        cookie: 'connect.sid=default-id; CustomSid=old-id; theme=dark',
        authorization: 'Bearer unrelated-token',
      },
    };
    const res = {};
    const next = vi.fn();
    const middleware = syncSessionIdFromHeader({ headerName: 'X-Session-Id', cookieName: 'CustomSid' });

    middleware(req, res, next);
    const firstCookie = req.headers.cookie;
    middleware(req, res, next);

    expect(req.headers.cookie).toBe(firstCookie);
    expect(parse(req.headers.cookie)).toEqual({
      'connect.sid': 'default-id',
      CustomSid: 'new-id',
      theme: 'dark',
    });
    expect(req.headers.authorization).toBe('Bearer unrelated-token');
    expect(res).toEqual({});
    expect(next).toHaveBeenCalledTimes(2);
  });

  it('does not carry a session ID between requests using the same middleware', () => {
    const middleware = syncSessionIdFromHeader({});
    const first = { headers: { 'connect.sid': 'first-id' } as Record<string, string> };
    const second = { headers: { 'connect.sid': 'second-id' } as Record<string, string> };
    const missing = { headers: {} as Record<string, string> };
    const next = vi.fn();

    middleware(first, {}, next);
    middleware(second, {}, next);
    middleware(missing, {}, next);

    expect(parse(first.headers.cookie)).toEqual({ 'connect.sid': 'first-id' });
    expect(parse(second.headers.cookie)).toEqual({ 'connect.sid': 'second-id' });
    expect(missing.headers).not.toHaveProperty('cookie');
    expect(next).toHaveBeenCalledTimes(3);
  });
});
