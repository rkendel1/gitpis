import { API_BASE } from './api.js';

// Polls the IDE event bus and broadcasts to subscribers.
// Target latency: < 250 ms (200 ms poll interval).
export class IdeEventStream {
  constructor(workspaceId) {
    this.workspaceId = workspaceId;
    this._listeners = new Set();
    this._fromTimestamp = Date.now();
    this._timer = null;
  }

  start() {
    if (this._timer) return;
    this._timer = setInterval(() => this._poll(), 200);
  }

  stop() {
    clearInterval(this._timer);
    this._timer = null;
  }

  subscribe(listener) {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  async _poll() {
    try {
      const res = await fetch(
        `${API_BASE}/workspaces/${this.workspaceId}/ide/events?from=${this._fromTimestamp}`
      );
      if (!res.ok) return;
      const events = await res.json();
      if (events.length > 0) {
        this._fromTimestamp = events[events.length - 1].timestamp + 1;
        for (const event of events) {
          for (const listener of this._listeners) {
            listener(event);
          }
        }
      }
    } catch {
      // ignore transient network errors
    }
  }
}
