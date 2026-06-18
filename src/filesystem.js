import fs from 'node:fs/promises';
import path from 'node:path';

export class WorkspaceFileSystem {
  constructor(rootDir) {
    this.rootDir = rootDir;
  }

  resolve(userPath = '.') {
    const resolved = path.resolve(this.rootDir, userPath);
    if (!resolved.startsWith(path.resolve(this.rootDir))) {
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
