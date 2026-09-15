import { expressSession } from '../../../src';
import type { SessionData, StoreCallback } from '../../../src/express-session';

export default class SyncStore extends expressSession.Store {
  sessions: Record<string, string> = Object.create(null);

  destroy(id: string, callback?: StoreCallback): void {
    delete this.sessions[id];
    callback?.();
  }

  get(
    id: string,
    callback: (error?: unknown, data?: SessionData | null) => void,
  ): void {
    callback(null, JSON.parse(this.sessions[id]));
  }

  set(id: string, data: SessionData, callback?: StoreCallback): void {
    this.sessions[id] = JSON.stringify(data);
    callback?.();
  }
}
