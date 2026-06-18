import fs from 'node:fs/promises';
import path from 'node:path';

export class WorkspaceFileSystem {
  constructor(rootDir) {
    this.rootDir = path.resolve(rootDir);
  }

  resolve(userPath = '.') {
    const resolved = path.resolve(this.rootDir, userPath);
    const rootWithSep = `${this.rootDir}${path.sep}`;
    if (resolved !== this.rootDir && !resolved.startsWith(rootWithSep)) {
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

  async mkdir(dirPath) {
    await fs.mkdir(this.resolve(dirPath), { recursive: true });
  }

  async remove(targetPath) {
    await fs.rm(this.resolve(targetPath), { recursive: true, force: true });
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
