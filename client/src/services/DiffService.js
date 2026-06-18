import { FileService } from './FileService.js';

// Implements: interface DiffService { compare(fileA, fileB): Promise<{original, modified, language}> }
export class DiffService {
  constructor(workspaceId) {
    this._fs = new FileService(workspaceId);
  }

  // Compare two workspace paths. Returns content ready for Monaco DiffEditor.
  async compare(pathA, pathB) {
    const [original, modified] = await Promise.all([
      this._fs.readFile(pathA).catch(() => ''),
      this._fs.readFile(pathB).catch(() => '')
    ]);
    return { original, modified, pathA, pathB };
  }

  // Compare a file against its last-committed version via git show HEAD:path.
  // Requires the terminal service to run git commands.
  async compareWithHead(path, terminalService, terminalId) {
    const [head, working] = await Promise.all([
      terminalService
        .execute(terminalId, 'git', ['show', `HEAD:${path}`])
        .then((r) => r.stdout)
        .catch(() => ''),
      this._fs.readFile(path).catch(() => '')
    ]);
    return { original: head, modified: working, pathA: `HEAD:${path}`, pathB: path };
  }
}
