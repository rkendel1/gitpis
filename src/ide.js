import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { EventEmitter } from 'node:events';

function runCommand(command, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: { ...process.env, ...(options.env ?? {}) },
      stdio: ['pipe', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('close', (code) => {
      resolve({
        ok: code === 0,
        code: code ?? 1,
        stdout: stdout.trimEnd(),
        stderr: stderr.trimEnd()
      });
    });

    if (options.stdin) {
      child.stdin.write(options.stdin);
    }
    child.stdin.end();
  });
}

function sanitizeGitArg(value, label, pattern = /^[A-Za-z0-9._/:+-]+$/) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Missing ${label}`);
  }
  if (value.startsWith('-')) {
    throw new Error(`Invalid ${label}`);
  }
  if (!pattern.test(value)) {
    throw new Error(`Invalid ${label}`);
  }
  return value;
}

// ─── IDE Event Protocol ───────────────────────────────────────────────────────

export const IdeEventType = {
  FileChanged: 'FileChanged',
  FileCreated: 'FileCreated',
  FileDeleted: 'FileDeleted',
  FileRenamed: 'FileRenamed',
  TerminalOutput: 'TerminalOutput',
  GitUpdate: 'GitUpdate',
  CursorMove: 'CursorMove',
  SessionHeartbeat: 'SessionHeartbeat',
  LspNotification: 'LspNotification',
  PresenceUpdate: 'PresenceUpdate'
};

export class IdeEventBus {
  constructor() {
    this._events = [];
    this._seq = 0;
    this._emitter = new EventEmitter();
  }

  append(workspaceId, type, payload = {}) {
    const event = {
      id: randomUUID(),
      workspaceId,
      type,
      timestamp: Date.now(),
      seq: ++this._seq,
      payload
    };
    this._events.push(event);
    this._emitter.emit('event', event);
    return event;
  }

  replay(workspaceId, fromTimestamp = 0) {
    return this._events.filter(
      (e) => e.workspaceId === workspaceId && e.timestamp >= fromTimestamp
    );
  }

  subscribe(listener) {
    this._emitter.on('event', listener);
    return () => this._emitter.off('event', listener);
  }
}

// ─── File Revision Model ──────────────────────────────────────────────────────

export class FileRevisionStore {
  constructor() {
    this._versions = new Map();
  }

  _key(workspaceId, filePath) {
    return `${workspaceId}:${filePath}`;
  }

  nextVersion(workspaceId, filePath) {
    const key = this._key(workspaceId, filePath);
    const v = (this._versions.get(key) ?? 0) + 1;
    this._versions.set(key, v);
    return v;
  }

  currentVersion(workspaceId, filePath) {
    return this._versions.get(this._key(workspaceId, filePath)) ?? 0;
  }

  hasConflict(workspaceId, filePath, expectedVersion) {
    return this.currentVersion(workspaceId, filePath) !== expectedVersion;
  }
}

// ─── Editor Sync Adapter ─────────────────────────────────────────────────────

export class MonacoSyncAdapter {
  constructor(fileService, eventBus) {
    this._fileService = fileService;
    this._eventBus = eventBus;
  }

  async applyRemoteChange(workspaceId, revision) {
    await this._fileService.writeFile(workspaceId, revision.path, revision.content);
  }

  emitLocalChange(workspaceId, revision) {
    this._eventBus.append(workspaceId, IdeEventType.FileChanged, {
      path: revision.path,
      version: revision.version,
      updatedAt: revision.updatedAt
    });
  }
}

// ─── LSP Gateway ─────────────────────────────────────────────────────────────

const LSP_SUPPORTED_LANGUAGES = new Set(['typescript', 'javascript', 'json', 'yaml', 'python']);

export class InMemoryLspGateway {
  constructor() {
    this._servers = new Map();
  }

  startServer(language, workspaceId) {
    if (!LSP_SUPPORTED_LANGUAGES.has(language)) {
      throw new Error(`Unsupported LSP language: ${language}`);
    }
    const serverId = randomUUID();
    const server = { serverId, language, workspaceId, startedAt: Date.now() };
    this._servers.set(serverId, server);
    return server;
  }

  async sendRequest(serverId, type, params = {}) {
    if (!this._servers.has(serverId)) {
      throw new Error(`LSP server not found: ${serverId}`);
    }
    return { serverId, type, result: null };
  }

  stopServer(serverId) {
    this._servers.delete(serverId);
  }

  list(workspaceId) {
    const all = [...this._servers.values()];
    return workspaceId ? all.filter((s) => s.workspaceId === workspaceId) : all;
  }
}

// ─── IDE State Snapshot ───────────────────────────────────────────────────────

export class IdeStateManager {
  constructor() {
    this._states = new Map();
  }

  update(workspaceId, patch) {
    const current = this._states.get(workspaceId) ?? {
      openFiles: [],
      activeTerminal: null,
      gitBranch: null,
      cursorPositions: {}
    };
    this._states.set(workspaceId, { ...current, ...patch });
    return this._states.get(workspaceId);
  }

  snapshot(workspaceId) {
    return this._states.get(workspaceId) ?? null;
  }
}

// ─── WebSocket Channel Constants ──────────────────────────────────────────────

export const IdeChannels = {
  Files: 'files',
  Terminal: 'terminal',
  Git: 'git',
  Lsp: 'lsp',
  Presence: 'presence',
  Events: 'events'
};

// ─── Git Sandbox Policy ───────────────────────────────────────────────────────

const GIT_BLOCKED_FLAGS = new Set([
  '--exec',
  '--upload-pack',
  '--receive-pack',
  '--ext-diff',
  '--no-index'
]);

function enforceGitSandbox(args) {
  for (const arg of args) {
    if (GIT_BLOCKED_FLAGS.has(arg)) {
      throw new Error(`Blocked git argument: ${arg}`);
    }
    if (/^--(?:exec|upload-pack|receive-pack|ext-diff)=/.test(arg)) {
      throw new Error(`Blocked git argument: ${arg}`);
    }
  }
}

// ─── Core Services ────────────────────────────────────────────────────────────

export class InMemoryIdeProvider {
  constructor() {
    this.sessions = new Map();
  }

  async initialize(workspaceId, userId = 'anonymous') {
    const session = {
      sessionId: randomUUID(),
      workspaceId,
      userId,
      createdAt: new Date().toISOString()
    };
    this.sessions.set(session.sessionId, session);
    return session;
  }

  async destroy(sessionId) {
    this.sessions.delete(sessionId);
  }
}

export class WorkspaceFileService {
  constructor(workspaceRuntime, options = {}) {
    this.workspaceRuntime = workspaceRuntime;
    this.watchers = new Map();
    this.eventBus = options.eventBus ?? null;
    this.revisionStore = options.revisionStore ?? new FileRevisionStore();
  }

  async readFile(workspaceId, filePath, encoding = 'utf8') {
    const filesystem = await this.workspaceRuntime.filesystem(workspaceId);
    return filesystem.readFile(filePath, encoding);
  }

  async writeFile(workspaceId, filePath, content) {
    // write-ahead: log the intent before persisting
    const version = this.revisionStore.nextVersion(workspaceId, filePath);
    this.eventBus?.append(workspaceId, IdeEventType.FileChanged, {
      path: filePath,
      version,
      updatedAt: Date.now()
    });
    const filesystem = await this.workspaceRuntime.filesystem(workspaceId);
    await filesystem.writeFile(filePath, content);
    this.#emit(workspaceId, { type: 'FileModified', path: filePath, timestamp: new Date().toISOString(), version });
  }

  async createFile(workspaceId, filePath, content = '') {
    const version = this.revisionStore.nextVersion(workspaceId, filePath);
    this.eventBus?.append(workspaceId, IdeEventType.FileCreated, {
      path: filePath,
      version,
      updatedAt: Date.now()
    });
    const filesystem = await this.workspaceRuntime.filesystem(workspaceId);
    await filesystem.createFile(filePath, content);
    this.#emit(workspaceId, { type: 'FileCreated', path: filePath, timestamp: new Date().toISOString(), version });
  }

  async deleteFile(workspaceId, filePath) {
    this.eventBus?.append(workspaceId, IdeEventType.FileDeleted, {
      path: filePath,
      updatedAt: Date.now()
    });
    const filesystem = await this.workspaceRuntime.filesystem(workspaceId);
    await filesystem.remove(filePath);
    this.#emit(workspaceId, { type: 'FileDeleted', path: filePath, timestamp: new Date().toISOString() });
  }

  async renameFile(workspaceId, fromPath, toPath) {
    this.eventBus?.append(workspaceId, IdeEventType.FileRenamed, {
      path: fromPath,
      nextPath: toPath,
      updatedAt: Date.now()
    });
    const filesystem = await this.workspaceRuntime.filesystem(workspaceId);
    await filesystem.rename(fromPath, toPath);
    this.#emit(workspaceId, {
      type: 'FileRenamed',
      path: fromPath,
      nextPath: toPath,
      timestamp: new Date().toISOString()
    });
  }

  async listDirectory(workspaceId, dirPath = '.') {
    const filesystem = await this.workspaceRuntime.filesystem(workspaceId);
    return filesystem.listDirectory(dirPath);
  }

  watchFile(workspaceId, listener) {
    const emitter = this.watchers.get(workspaceId) ?? new EventEmitter();
    emitter.on('change', listener);
    this.watchers.set(workspaceId, emitter);
    return () => emitter.off('change', listener);
  }

  #emit(workspaceId, event) {
    this.watchers.get(workspaceId)?.emit('change', event);
  }
}

export class WorkspaceTerminalService {
  constructor(workspaceRuntime, options = {}) {
    this.workspaceRuntime = workspaceRuntime;
    this.terminals = new Map();
    this.eventBus = options.eventBus ?? null;
  }

  async createTerminal(workspaceId, options = {}) {
    const workspace = this.workspaceRuntime.list().find((item) => item.id === workspaceId);
    if (!workspace) {
      throw new Error(`Workspace not found: ${workspaceId}`);
    }
    const terminal = {
      terminalId: randomUUID(),
      workspaceId,
      cwd: options.cwd ? path.resolve(workspace.repoPath, options.cwd) : workspace.repoPath,
      env: options.env ?? {},
      createdAt: new Date().toISOString(),
      lastOutput: []
    };
    this.terminals.set(terminal.terminalId, terminal);
    return terminal;
  }

  async execute(terminalId, command, args = [], options = {}) {
    const terminal = this.terminals.get(terminalId);
    if (!terminal) {
      throw new Error(`Terminal not found: ${terminalId}`);
    }
    const startedAt = Date.now();
    const result = await runCommand(command, args, {
      cwd: options.cwd ? path.resolve(terminal.cwd, options.cwd) : terminal.cwd,
      env: { ...terminal.env, ...options.env },
      stdin: options.stdin
    });
    const finishedAt = Date.now();
    const record = {
      command,
      args,
      exitCode: result.code,
      stdout: result.stdout,
      stderr: result.stderr,
      startedAt,
      finishedAt
    };
    terminal.lastOutput.push(record);
    this.eventBus?.append(terminal.workspaceId, IdeEventType.TerminalOutput, {
      terminalId,
      command,
      exitCode: result.code,
      startedAt,
      finishedAt
    });
    return result;
  }

  streamOutput(terminalId) {
    return this.terminals.get(terminalId)?.lastOutput ?? [];
  }

  async destroy(terminalId) {
    this.terminals.delete(terminalId);
  }
}

export class WorkspaceGitService {
  constructor(workspaceRuntime, options = {}) {
    this.workspaceRuntime = workspaceRuntime;
    this.eventBus = options.eventBus ?? null;
  }

  #workspacePath(workspaceId) {
    const workspace = this.workspaceRuntime.list().find((item) => item.id === workspaceId);
    if (!workspace) {
      throw new Error(`Workspace not found: ${workspaceId}`);
    }
    return workspace.repoPath;
  }

  async #git(workspaceId, args) {
    enforceGitSandbox(args);
    const result = await runCommand('git', args, { cwd: this.#workspacePath(workspaceId) });
    this.eventBus?.append(workspaceId, IdeEventType.GitUpdate, {
      op: args[0],
      ok: result.ok
    });
    return result;
  }

  async status(workspaceId) {
    return this.#git(workspaceId, ['status', '--porcelain', '--branch']);
  }

  async commit(workspaceId, message, options = {}) {
    if (options.stageAll !== false) {
      await this.#git(workspaceId, ['add', '-A']);
    }
    const result = await this.#git(workspaceId, ['commit', '-m', message]);
    const noChangesText = `${result.stdout}\n${result.stderr}`;
    if (!result.ok && /nothing to commit|no changes added to commit/i.test(noChangesText)) {
      return { ...result, ok: true, noChanges: true };
    }
    return result;
  }

  async push(workspaceId, remote = 'origin', branch) {
    const args = ['push', '--', sanitizeGitArg(remote, 'remote', /^[A-Za-z0-9._/-]+$/)];
    if (branch) {
      args.push(sanitizeGitArg(branch, 'branch', /^[A-Za-z0-9._/-]+$/));
    }
    return this.#git(workspaceId, args);
  }

  async pull(workspaceId, remote = 'origin', branch) {
    const args = ['pull', '--', sanitizeGitArg(remote, 'remote', /^[A-Za-z0-9._/-]+$/)];
    if (branch) {
      args.push(sanitizeGitArg(branch, 'branch', /^[A-Za-z0-9._/-]+$/));
    }
    return this.#git(workspaceId, args);
  }

  async branch(workspaceId, name) {
    return this.#git(workspaceId, ['branch', '--', sanitizeGitArg(name, 'branch name', /^[A-Za-z0-9._/-]+$/)]);
  }

  async checkout(workspaceId, ref) {
    return this.#git(workspaceId, ['checkout', '--', sanitizeGitArg(ref, 'ref')]);
  }
}

export class WorkspaceSocket {
  constructor() {
    this.channels = new Map();
  }

  subscribe(channel, listener) {
    const emitter = this.channels.get(channel) ?? new EventEmitter();
    emitter.on('message', listener);
    this.channels.set(channel, emitter);
    return () => emitter.off('message', listener);
  }

  publish(channel, payload) {
    this.channels.get(channel)?.emit('message', payload);
  }
}
