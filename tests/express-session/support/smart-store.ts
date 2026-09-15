import { Store } from '../../../src/express-session/session/store.ts';
import type { SessionData, StoreCallback } from '../../../src/express-session/session/store.ts';

export default class SmartStore extends Store {
  sessions: Record<string, string> = Object.create(null);

  destroy(id: string, callback?: StoreCallback): void {
    delete this.sessions[id];
    if (callback) setImmediate(callback, null);
  }

  get(
    id: string,
    callback: (error?: unknown, data?: SessionData | null) => void,
  ): void {
    const stored = this.sessions[id];
    // Preserve the upstream fixture's missing-session behavior.
    if (!stored) return;
    let data = JSON.parse(stored) as SessionData | null;
    if (data?.cookie) {
      if (typeof data.cookie.expires === 'string')
        data.cookie.expires = new Date(data.cookie.expires);
      if (data.cookie.expires && Number(data.cookie.expires) <= Date.now()) {
        delete this.sessions[id];
        data = null;
      }
    }
    setImmediate(callback, null, data);
  }

  set(id: string, data: SessionData, callback?: StoreCallback): void {
    this.sessions[id] = JSON.stringify(data);
    if (callback) setImmediate(callback, null);
  }
}
