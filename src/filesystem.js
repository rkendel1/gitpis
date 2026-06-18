import fs from 'node:fs/promises';
import path from 'node:path';

function normalizeSandboxPath(value) {
  if (process.platform === 'win32') {
    return value.toLowerCase();
  }
  return value;
}

export class WorkspaceFileSystem {
  constructor(rootDir, options = {}) {
    this.rootDir = path.resolve(rootDir);
    this.journal = options.journal;
  }

  resolve(userPath = '.') {
    const resolved = path.resolve(this.rootDir, userPath);
    const normalizedRoot = normalizeSandboxPath(this.rootDir);
    const normalizedResolved = normalizeSandboxPath(resolved);
    const rootWithSep = `${normalizedRoot}${path.sep}`;
    if (normalizedResolved !== normalizedRoot && !normalizedResolved.startsWith(rootWithSep)) {
      throw new Error('Path escapes workspace sandbox');
    }
    return resolved;
  }

  async readFile(filePath, encoding = 'utf8') {
    return fs.readFile(this.resolve(filePath), encoding);
  }

  async writeFile(filePath, content) {
    const resolved = this.resolve(filePath);
    await fs.mkdir(path.dirname(resolved), { recursive: true });
    await fs.writeFile(resolved, content);
    this.journal?.recordChange?.('modify', filePath);
  }

  async mkdir(dirPath) {
    await fs.mkdir(this.resolve(dirPath), { recursive: true });
    this.journal?.recordChange?.('create', dirPath);
  }

  async remove(targetPath) {
    await fs.rm(this.resolve(targetPath), { recursive: true, force: true });
    this.journal?.recordChange?.('delete', targetPath);
  }

  async list(dir = '.') {
    return fs.readdir(this.resolve(dir));
  }

  async snapshot(snapshotPath) {
    const data = JSON.stringify({ rootDir: this.rootDir, createdAt: new Date().toISOString() });
    await fs.writeFile(snapshotPath, data);
    return snapshotPath;
  }
}
