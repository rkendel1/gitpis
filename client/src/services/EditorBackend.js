// VS Code Web Compatibility Layer
// Future: replace with a real vscode-web / Monaco language server backend.
//
// Implements: interface EditorBackend {
//   readFile(path): Promise<string>
//   writeFile(path, content): Promise<void>
//   watchFile(listener): () => void
//   listFiles(path): Promise<string[]>
// }
export class EditorBackend {
  constructor(fileService, fileWatcher) {
    this._fileService = fileService;
    this._fileWatcher = fileWatcher;
  }

  readFile(path) {
    return this._fileService.readFile(path);
  }

  writeFile(path, content) {
    return this._fileService.writeFile(path, content);
  }

  watchFile(listener) {
    return this._fileWatcher.subscribe(listener);
  }

  listFiles(path = '.') {
    return this._fileService.listDirectory(path);
  }
}
