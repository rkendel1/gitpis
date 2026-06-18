import { spawn } from 'node:child_process';
import readline from 'node:readline';
import { EventEmitter, on } from 'node:events';
import { WorkspaceFileSystem } from './filesystem.js';

const COMPATIBLE_FRAMEWORKS = ['node', 'rust', 'go', 'python', 'static', 'vite', 'react', 'vue', 'svelte', 'nextjs'];
const DEFAULT_RESOURCE_LIMITS = { memoryMb: 512, cpuPercent: 100, maxProcesses: 10 };
const COMMON_PORTS = new Set([3000, 4173, 5000, 5173, 8000, 8080]);

function createLogLine(prefix, line) {
  const text = line.trim();
  if (!text) return null;
  return `[${prefix}] ${text}`;
}

function parsePorts(line) {
  const matches = line.match(/(?:localhost|127\.0\.0\.1|0\.0\.0\.0):(\d{2,5})|\b(\d{4,5})\b/g) ?? [];
  const ports = [];

  for (const token of matches) {
    const digits = Number(token.replace(/\D+/g, ''));
    if (Number.isInteger(digits) && digits > 0 && digits < 65536) {
      ports.push(digits);
    }
  }

  return ports;
}

function spawnShell(command, cwd, env = process.env) {
  return spawn('sh', ['-lc', command], {
    cwd,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true
  });
}

async function runAndCapture(command, cwd, onLog, env) {
  const child = spawnShell(command, cwd, env);

  const pipe = (stream, prefix) => {
    const reader = readline.createInterface({ input: stream });
    reader.on('line', (line) => {
      const message = createLogLine(prefix, line);
      if (message) onLog(message);
    });
  };

  pipe(child.stdout, 'build');
  pipe(child.stderr, 'build');

  return await new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Build failed: ${command}`));
      }
    });
  });
}

class WasmtimeRuntimeInstance {
  constructor(artifact) {
    this.id = artifact.id;
    this.runtime = artifact.runtime;
    this.mountPath = artifact.mountPath;
    this.buildCommand = artifact.buildCommand;
    this.startCommand = artifact.startCommand;
    this.defaultPort = artifact.defaultPort;
    this.protocol = 'http';
    this.process = null;
    this.status = 'stopped';
    this.stopping = false;
    this.logEmitter = new EventEmitter();
    this.logBuffer = [];
    this.maxLogLines = 500;
    this.onEvent = artifact.onEvent ?? (() => {});
    this.onHealth = artifact.onHealth ?? (() => {});
    this.onPort = artifact.onPort ?? (() => {});
    this.portsByNumber = new Map();
    this.resourceLimits = artifact.resourceLimits ?? DEFAULT_RESOURCE_LIMITS;

    if (this.defaultPort) {
      this.#registerPort(this.defaultPort);
    }
  }

  async start() {
    if (this.status === 'running' || this.status === 'starting') {
      return;
    }

    this.#setStatus('starting');
    this.#emitEvent('WorkspaceStarted', { id: this.id });
    this.#emitLog('[workspace] starting');

    try {
      if (this.buildCommand && this.buildCommand !== 'none') {
        this.#emitLog(`[workspace] build: ${this.buildCommand}`);
        await runAndCapture(this.buildCommand, this.mountPath, (line) => this.#emitLog(line), process.env);
      }

      if (!this.startCommand || this.startCommand === 'serve static assets') {
        this.#emitLog('[workspace] static workspace ready');
        this.#setStatus('running');
        return;
      }

      const child = spawnShell(this.startCommand, this.mountPath, {
        ...process.env,
        PORT: String(this.defaultPort ?? 8080)
      });
      this.process = child;
      this.stopping = false;

      const handleLine = (prefix) => (line) => {
        const message = createLogLine(prefix, line);
        if (!message) return;
        this.#emitLog(message);
        for (const port of parsePorts(line)) {
          if (COMMON_PORTS.has(port) || port === this.defaultPort) {
            this.#registerPort(port);
          }
        }
      };

      readline.createInterface({ input: child.stdout }).on('line', handleLine('stdout'));
      readline.createInterface({ input: child.stderr }).on('line', handleLine('stderr'));

      child.on('error', (error) => {
        this.#emitLog(`[workspace] runtime error: ${error.message}`);
        this.#setStatus('failed');
        this.#emitEvent('WorkspaceFailed', { id: this.id, reason: error.message });
      });

      child.on('close', (code, signal) => {
        this.process = null;
        if (this.stopping) {
          this.#setStatus('stopped');
          this.#emitEvent('WorkspaceStopped', { id: this.id });
          return;
        }

        if (code === 0 || signal === 'SIGTERM' || signal === 'SIGINT') {
          this.#setStatus('stopped');
          this.#emitEvent('WorkspaceStopped', { id: this.id });
          return;
        }

        this.#emitLog(`[workspace] process exited code=${code}`);
        this.#setStatus('failed');
        this.#emitEvent('WorkspaceFailed', { id: this.id, code });
      });

      this.#setStatus('running');
    } catch (error) {
      this.#emitLog(`[workspace] startup failed: ${error.message}`);
      this.#setStatus('failed');
      this.#emitEvent('WorkspaceFailed', { id: this.id, reason: error.message });
      throw error;
    }
  }

  async stop() {
    this.stopping = true;
    if (!this.process) {
      this.#setStatus('stopped');
      this.#emitEvent('WorkspaceStopped', { id: this.id });
      return;
    }

    if (this.process.pid) {
      try {
        process.kill(-this.process.pid, 'SIGTERM');
      } catch {
        this.process.kill('SIGTERM');
      }
    } else {
      this.process.kill('SIGTERM');
    }

    await new Promise((resolve) => {
      const timeout = setTimeout(() => {
        if (this.process) {
          try {
            process.kill(-this.process.pid, 'SIGKILL');
          } catch {
            this.process.kill('SIGKILL');
          }
        }
      }, 1500);

      const done = () => {
        clearTimeout(timeout);
        resolve();
      };

      this.process.once('close', done);
      this.process.once('exit', done);
    });
  }

  async restart() {
    this.#emitEvent('WorkspaceRestarted', { id: this.id });
    await this.stop();
    await this.start();
  }

  async health() {
    return this.status;
  }

  async *logs() {
    for (const line of this.logBuffer) {
      yield line;
    }

    for await (const [line] of on(this.logEmitter, 'log')) {
      yield String(line);
    }
  }

  getRecentLogs(limit = 200) {
    return this.logBuffer.slice(-Math.max(1, limit));
  }

  async ports() {
    return [...this.portsByNumber.values()];
  }

  async filesystem() {
    return new WorkspaceFileSystem(this.mountPath);
  }

  #setStatus(nextStatus) {
    const previous = this.status;
    this.status = nextStatus;
    this.onHealth(nextStatus, previous);
    if (previous !== nextStatus) {
      this.#emitEvent('HealthChanged', { id: this.id, previous, current: nextStatus });
    }
  }

  #emitLog(line) {
    const stamped = `${new Date().toISOString()} ${line}`;
    this.logBuffer.push(stamped);
    if (this.logBuffer.length > this.maxLogLines) {
      this.logBuffer.shift();
    }
    this.logEmitter.emit('log', stamped);
  }

  #registerPort(port) {
    if (this.portsByNumber.has(port)) {
      return;
    }

    const info = {
      port,
      protocol: this.protocol,
      publicUrl: `http://localhost:${port}`
    };
    this.portsByNumber.set(port, info);
    this.onPort(info);
    this.#emitEvent('PortDiscovered', { id: this.id, ...info });
  }

  #emitEvent(type, payload = {}) {
    this.onEvent({
      type,
      timestamp: new Date().toISOString(),
      ...payload
    });
  }
}

export class RuntimeProviderRegistry {
  constructor() {
    this.providers = [];
  }

  register(provider) {
    this.providers.push(provider);
  }

  findCompatible(analysis) {
    return this.providers.find((provider) => provider.canRun(analysis));
  }
}

export class WasmtimeProvider {
  canRun(repoAnalysis) {
    return COMPATIBLE_FRAMEWORKS.includes(repoAnalysis.framework);
  }

  async build(repository) {
    return {
      id: repository.workspaceId,
      runtime: 'wasmtime',
      buildCommand: repository.executionPlan.build,
      startCommand: repository.executionPlan.start,
      mountPath: repository.path,
      defaultPort: repository.executionPlan.defaultPort,
      resourceLimits: repository.resourceLimits ?? DEFAULT_RESOURCE_LIMITS,
      onEvent: repository.onEvent,
      onHealth: repository.onHealth,
      onPort: repository.onPort
    };
  }

  async execute(artifact) {
    return new WasmtimeRuntimeInstance(artifact);
  }
}

export function defaultRuntimeCandidates() {
  return ['wasmtime', 'wasmer', 'wamr', 'jco', 'wasi-preview2', 'component-model'];
}

export function defaultResourceLimits() {
  return { ...DEFAULT_RESOURCE_LIMITS };
}
