import { parse } from 'cookie';
import { getSignedSessionId, syncSessionIdFromHeader } from '../../src';

describe('syncSessionIdFromHeader', () => {
  it.each(['X-Session-Id', 'X-SESSION-ID', 'x-session-id'])('accepts configured header name %s', headerName => {
    const sessionId = getSignedSessionId('session-id', 'test-secret');
    const req = { headers: { 'x-session-id': sessionId, cookie: 'theme=dark; CustomSid=old' } };
    const next = jest.fn();

    syncSessionIdFromHeader({ headerName, cookieName: 'CustomSid' })(req, {}, next);

    expect(parse(req.headers.cookie)).toEqual({ theme: 'dark', CustomSid: sessionId });
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('keeps the default header and cookie names', () => {
    const req: { headers: Record<string, string> } = { headers: { 'connect.sid': 'session-id' } };
    const next = jest.fn();

    syncSessionIdFromHeader({})(req, {}, next);

    expect(parse(req.headers.cookie)).toEqual({ 'connect.sid': 'session-id' });
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('preserves existing cookies when the session header is missing', () => {
    const req = { headers: { cookie: 'theme=dark; connect.sid=existing' } };
    const next = jest.fn();

    syncSessionIdFromHeader({ headerName: 'X-Session-Id' })(req, {}, next);

    expect(req.headers.cookie).toBe('theme=dark; connect.sid=existing');
    expect(next).toHaveBeenCalledTimes(1);
  });
});
