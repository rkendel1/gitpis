import { useMemo, useEffect } from 'react';
import { FileService } from '../services/FileService.js';
import { EditorBackend } from '../services/EditorBackend.js';
import { FileWatcher } from '../services/FileWatcher.js';
import { IdeEventStream } from '../services/IdeEventStream.js';
import { TerminalService } from '../services/TerminalService.js';
import { GitService } from '../services/GitService.js';
import { DiffService } from '../services/DiffService.js';
import { SearchService } from '../services/SearchService.js';

// Creates and wires all IDE services for a given workspace.
// Starts the event stream and cleans up on unmount.
export function useIdeServices(workspaceId) {
  const services = useMemo(() => {
    if (!workspaceId) return null;

    const eventStream = new IdeEventStream(workspaceId);
    const fileService = new FileService(workspaceId);
    const fileWatcher = new FileWatcher(eventStream);
    const editorBackend = new EditorBackend(fileService, fileWatcher);
    const terminalService = new TerminalService(workspaceId);
    const gitService = new GitService(workspaceId);
    const diffService = new DiffService(workspaceId);
    const searchService = new SearchService(workspaceId);

    return { eventStream, fileService, fileWatcher, editorBackend, terminalService, gitService, diffService, searchService };
  }, [workspaceId]);

  useEffect(() => {
    if (!services) return;
    services.eventStream.start();
    return () => services.eventStream.stop();
  }, [services]);

  return services;
}
