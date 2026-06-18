const FILE_EVENT_TYPES = new Set(['FileChanged', 'FileCreated', 'FileDeleted', 'FileRenamed']);

// Implements: interface FileWatcher
// Bridges IdeEventStream events to file-change callbacks.
export class FileWatcher {
  constructor(eventStream) {
    this._eventStream = eventStream;
  }

  // Returns an unsubscribe function.
  subscribe(listener) {
    return this._eventStream.subscribe((event) => {
      if (FILE_EVENT_TYPES.has(event.type)) {
        listener({
          type: event.type,
          path: event.payload.path,
          nextPath: event.payload.nextPath ?? null,
          version: event.payload.version ?? null
        });
      }
    });
  }
}
