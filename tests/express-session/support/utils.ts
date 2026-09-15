import type { ServerResponse } from 'node:http';

export interface ParsedCookie {
  name: string;
  value: string;
  [attribute: string]: string | boolean;
}

export function parseSetCookie(header: string): ParsedCookie {
  const pairs: { name: string; value: string }[] = [];
  const pattern = /\s*([^=;]+)(?:=([^;]*);?|;|$)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(header)))
    pairs.push({ name: match[1], value: match[2] });
  const cookie = pairs.shift()! as ParsedCookie;
  for (const pair of pairs)
    cookie[pair.name.toLowerCase()] = pair.value || true;
  return cookie;
}

export function writePatch(res: ServerResponse): void {
  const end = res.end;
  const write = res.write;
  let ended = false;
  res.end = function (...args: Parameters<ServerResponse['end']>) {
    ended = true;
    return end.apply(this, args);
  } as ServerResponse['end'];
  res.write = function (...args: Parameters<ServerResponse['write']>) {
    if (ended) throw new Error('write after end');
    return write.apply(this, args);
  } as ServerResponse['write'];
}
