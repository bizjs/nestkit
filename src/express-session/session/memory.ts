import { Store } from './store';
import type { SessionData, StoreCallback } from './store';

export class MemoryStore extends Store {
  sessions: Record<string, string> = Object.create(null);

  all(callback?: (error: unknown, sessions: Record<string, SessionData>) => void): void {
    const sessions: Record<string, SessionData> = Object.create(null);
    for (const id of Object.keys(this.sessions)) {
      const session = this.getSession(id);
      if (session) sessions[id] = session;
    }
    if (callback) setImmediate(callback, null, sessions);
  }

  clear(callback?: StoreCallback): void {
    this.sessions = Object.create(null);
    if (callback) setImmediate(callback);
  }

  override destroy(id: string, callback?: StoreCallback): void {
    delete this.sessions[id];
    if (callback) setImmediate(callback);
  }

  override get(id: string, callback: (error?: unknown, data?: SessionData | null) => void): void {
    setImmediate(callback, null, this.getSession(id));
  }

  override set(id: string, data: SessionData, callback?: StoreCallback): void {
    this.sessions[id] = JSON.stringify(data);
    if (callback) setImmediate(callback);
  }

  length(callback: (error?: unknown, length?: number) => void): void {
    this.all((error, sessions) => {
      if (error) return callback(error);
      callback(null, Object.keys(sessions).length);
    });
  }

  touch(id: string, data: SessionData, callback?: StoreCallback): void {
    const current = this.getSession(id);
    if (current) {
      current.cookie = data.cookie;
      this.sessions[id] = JSON.stringify(current);
    }
    if (callback) setImmediate(callback);
  }

  private getSession(id: string): SessionData | undefined {
    const stored = this.sessions[id];
    if (!stored) return;
    const session: SessionData = JSON.parse(stored);
    if (session.cookie) {
      const expires =
        typeof session.cookie.expires === 'string' ? new Date(session.cookie.expires) : session.cookie.expires;
      if (expires && Number(expires) <= Date.now()) {
        delete this.sessions[id];
        return;
      }
    }
    return session;
  }
}
