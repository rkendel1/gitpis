import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';

const EXCLUDED_NAMES = new Set(['.git', '.snapshots', '.workspace-journal.json']);
const EXCLUDED_SEGMENTS = new Set(['tmp', 'temp', '.tmp']);

function toPosix(relPath) {
  return relPath.split(path.sep).join('/');
}

function shouldExclude(relativePath) {
  if (!relativePath || relativePath === '.') return false;
  const parts = toPosix(relativePath).split('/').filter(Boolean);
  const base = parts.at(-1) ?? '';
  if (EXCLUDED_NAMES.has(base)) return true;
  if (base.endsWith('.log')) return true;
  return parts.some((part) => EXCLUDED_SEGMENTS.has(part));
}

async function fileExists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

async function createFileManifest(rootDir, current = '.', manifest = {}) {
  const absolute = current === '.' ? rootDir : path.join(rootDir, current);
  const entries = await fs.readdir(absolute, { withFileTypes: true });

  for (const entry of entries) {
    const relative = current === '.' ? entry.name : path.join(current, entry.name);
    if (shouldExclude(relative)) continue;
    const fullPath = path.join(rootDir, relative);
    if (entry.isDirectory()) {
      await createFileManifest(rootDir, relative, manifest);
      continue;
    }

    const content = await fs.readFile(fullPath);
    const hash = createHash('sha256').update(content).digest('hex');
    manifest[toPosix(relative)] = hash;
  }

  return manifest;
}

function createIncrementalSnapshot(baseManifest = {}, nextManifest = {}) {
  const changedFiles = [];
  const deletedFiles = [];
  for (const [name, hash] of Object.entries(nextManifest)) {
    if (baseManifest[name] !== hash) {
      changedFiles.push(name);
    }
  }
  for (const name of Object.keys(baseManifest)) {
    if (!(name in nextManifest)) {
      deletedFiles.push(name);
    }
  }
  return { changedFiles, deletedFiles };
}

export class FilesystemJournal {
  constructor(entries = []) {
    this.entries = Array.isArray(entries) ? [...entries] : [];
  }

  recordChange(type, target, nextTarget = null) {
    this.entries.push({
      type,
      target,
      nextTarget,
      timestamp: new Date().toISOString()
    });
  }

  async replay(handler) {
    for (const entry of this.entries) {
      await handler(entry);
    }
  }

  compact(maxEntries = 1000) {
    if (this.entries.length <= maxEntries) return;
    this.entries = this.entries.slice(-maxEntries);
  }
}

export class LocalSnapshotStorageProvider {
  constructor(options = {}) {
    this.baseDir = options.baseDir ?? path.resolve('.snapshots');
    this.indexPath = path.join(this.baseDir, 'index.json');
  }

  async #readIndex() {
    if (!(await fileExists(this.indexPath))) return {};
    const raw = await fs.readFile(this.indexPath, 'utf8');
    return JSON.parse(raw);
  }

  async #writeIndex(index) {
    await fs.mkdir(this.baseDir, { recursive: true });
    await fs.writeFile(this.indexPath, JSON.stringify(index, null, 2));
  }

  async save(snapshot) {
    const snapshotRoot = path.join(this.baseDir, snapshot.workspaceId, snapshot.id);
    const filesystemRoot = path.join(snapshotRoot, 'filesystem');
    await fs.rm(snapshotRoot, { recursive: true, force: true });
    await fs.mkdir(snapshotRoot, { recursive: true });
    await fs.cp(snapshot.workspacePath, filesystemRoot, {
      recursive: true,
      force: true,
      filter: (src) => {
        const relative = path.relative(snapshot.workspacePath, src);
        return !shouldExclude(relative);
      }
    });

    const metadata = {
      ...snapshot,
      filesystemPath: filesystemRoot
    };
    await fs.writeFile(path.join(snapshotRoot, 'snapshot.json'), JSON.stringify(metadata, null, 2));
    const index = await this.#readIndex();
    index[snapshot.id] = { workspaceId: snapshot.workspaceId, snapshotRoot };
    await this.#writeIndex(index);
  }

  async load(snapshotId) {
    const index = await this.#readIndex();
    const entry = index[snapshotId];
    if (!entry) {
      throw new Error(`Snapshot not found: ${snapshotId}`);
    }
    const metadataPath = path.join(entry.snapshotRoot, 'snapshot.json');
    const raw = await fs.readFile(metadataPath, 'utf8');
    return JSON.parse(raw);
  }

  async delete(snapshotId) {
    const index = await this.#readIndex();
    const entry = index[snapshotId];
    if (!entry) return;
    await fs.rm(entry.snapshotRoot, { recursive: true, force: true });
    delete index[snapshotId];
    await this.#writeIndex(index);
  }

  async list(workspaceId) {
    const dir = path.join(this.baseDir, workspaceId);
    if (!(await fileExists(dir))) return [];
    const entries = await fs.readdir(dir);
    const snapshots = [];
    for (const entry of entries) {
      const metadataPath = path.join(dir, entry, 'snapshot.json');
      if (!(await fileExists(metadataPath))) continue;
      const raw = await fs.readFile(metadataPath, 'utf8');
      snapshots.push(JSON.parse(raw));
    }
    snapshots.sort((a, b) => Number(new Date(b.createdAt)) - Number(new Date(a.createdAt)));
    return snapshots;
  }
}

export class SnapshotEngine {
  constructor(options = {}) {
    this.storage = options.storageProvider ?? new LocalSnapshotStorageProvider(options);
    this.compression = options.compression ?? 'zstd';
  }

  async create(workspaceId, options = {}) {
    if (!options.workspacePath) {
      throw new Error('workspacePath is required to create a snapshot');
    }
    const previousManifest = options.previousSnapshot?.manifest ?? {};
    const manifest = await createFileManifest(options.workspacePath);
    const incremental = createIncrementalSnapshot(previousManifest, manifest);

    const snapshot = {
      id: randomUUID(),
      workspaceId,
      createdAt: new Date().toISOString(),
      compression: this.compression,
      workspacePath: options.workspacePath,
      environmentVariables: options.environmentVariables ?? {},
      runtimeMetadata: options.runtimeMetadata ?? {},
      incrementalSnapshot: {
        baseSnapshotId: options.previousSnapshot?.id ?? null,
        changedFiles: incremental.changedFiles,
        deletedFiles: incremental.deletedFiles
      },
      manifest
    };

    await this.storage.save(snapshot);
    return snapshot;
  }

  async restore(snapshotId, destinationPath) {
    const snapshot = await this.storage.load(snapshotId);
    const targetPath = destinationPath ?? snapshot.workspacePath;
    if (!targetPath) {
      throw new Error(`No restore destination available for snapshot: ${snapshotId}`);
    }

    await fs.rm(targetPath, { recursive: true, force: true });
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.cp(snapshot.filesystemPath, targetPath, { recursive: true, force: true });
    return snapshot;
  }

  async delete(snapshotId) {
    await this.storage.delete(snapshotId);
  }

  async list(workspaceId) {
    if (!this.storage.list) return [];
    return this.storage.list(workspaceId);
  }
}
