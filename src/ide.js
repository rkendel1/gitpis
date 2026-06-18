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
  constructor(workspaceRuntime) {
    this.workspaceRuntime = workspaceRuntime;
    this.watchers = new Map();
  }

  async readFile(workspaceId, filePath, encoding = 'utf8') {
    const filesystem = await this.workspaceRuntime.filesystem(workspaceId);
    return filesystem.readFile(filePath, encoding);
  }

  async writeFile(workspaceId, filePath, content) {
    const filesystem = await this.workspaceRuntime.filesystem(workspaceId);
    await filesystem.writeFile(filePath, content);
    this.#emit(workspaceId, { type: 'FileModified', path: filePath, timestamp: new Date().toISOString() });
  }

  async createFile(workspaceId, filePath, content = '') {
    const filesystem = await this.workspaceRuntime.filesystem(workspaceId);
    await filesystem.createFile(filePath, content);
    this.#emit(workspaceId, { type: 'FileCreated', path: filePath, timestamp: new Date().toISOString() });
  }

  async deleteFile(workspaceId, filePath) {
    const filesystem = await this.workspaceRuntime.filesystem(workspaceId);
    await filesystem.remove(filePath);
    this.#emit(workspaceId, { type: 'FileDeleted', path: filePath, timestamp: new Date().toISOString() });
  }

  async renameFile(workspaceId, fromPath, toPath) {
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
  constructor(workspaceRuntime) {
    this.workspaceRuntime = workspaceRuntime;
    this.terminals = new Map();
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
    const result = await runCommand(command, args, {
      cwd: options.cwd ? path.resolve(terminal.cwd, options.cwd) : terminal.cwd,
      env: options.env,
      stdin: options.stdin
    });
    terminal.lastOutput.push({
      timestamp: new Date().toISOString(),
      stdin: options.stdin ?? null,
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.code
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
  constructor(workspaceRuntime) {
    this.workspaceRuntime = workspaceRuntime;
  }

  #workspacePath(workspaceId) {
    const workspace = this.workspaceRuntime.list().find((item) => item.id === workspaceId);
    if (!workspace) {
      throw new Error(`Workspace not found: ${workspaceId}`);
    }
    return workspace.repoPath;
  }

  async #git(workspaceId, args) {
    return runCommand('git', args, { cwd: this.#workspacePath(workspaceId) });
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
