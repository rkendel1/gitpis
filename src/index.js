import path from 'node:path';
import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { cloneRepository, analyzeRepository } from './repository.js';
import { detectFramework, generateExecutionPlan } from './frameworkDetector.js';
import { RuntimeProviderRegistry, WasmtimeProvider, defaultRuntimeCandidates, defaultResourceLimits } from './providers.js';

const WORKSPACE_BASE = path.resolve('.wasm-workspaces');
const RUNTIME_DIR = 'runtime';
const WORKSPACE_DIR = 'workspace';
const MAX_EVENT_HISTORY = 500;

export const WorkspaceStatus = {
  Starting: 'starting',
  Running: 'running',
  Unhealthy: 'unhealthy',
  Stopped: 'stopped',
  Failed: 'failed'
};

export class InMemoryWasmWorkspace {
  constructor(options = {}) {
    this.workspaceBase = options.workspaceBase ?? WORKSPACE_BASE;
    this.workspaces = new Map();
    this.runtimeInstances = new Map();
    this.workspaceEvents = new Map();
    this.registry = new RuntimeProviderRegistry();
    this.registry.register(new WasmtimeProvider());
    this.runtimeCandidates = defaultRuntimeCandidates();
    this.resourceLimits = options.resourceLimits ?? defaultResourceLimits();
  }

  async launch(repoUrl) {
    const id = randomUUID();
    const workspaceRoot = path.join(this.workspaceBase, id, RUNTIME_DIR, WORKSPACE_DIR);

    await fs.mkdir(path.dirname(workspaceRoot), { recursive: true });
    const repoPath = await cloneRepository(repoUrl, workspaceRoot);
    const framework = await detectFramework(repoPath);
    const executionPlan = generateExecutionPlan(framework);
    const repository = await analyzeRepository(repoPath);
    const analysis = { ...repository, framework };
    const provider = this.registry.findCompatible(analysis);

    if (!provider) {
      throw new Error(`No compatible runtime provider for framework: ${framework}`);
    }

    const workspace = {
      id,
      repoUrl,
      repoPath,
      framework,
      executionPlan,
      runtime: 'wasmtime',
      status: WorkspaceStatus.Starting,
      createdAt: new Date().toISOString(),
      health: WorkspaceStatus.Starting,
      resourceLimits: { ...this.resourceLimits }
    };

    this.workspaces.set(id, workspace);
    this.workspaceEvents.set(id, []);
    this.#recordEvent(id, 'WorkspaceCreated', { id });

    const artifact = await provider.build({
      ...analysis,
      executionPlan,
      workspaceId: id,
      resourceLimits: workspace.resourceLimits,
      onEvent: (event) => this.#recordEvent(id, event.type, event),
      onHealth: (nextStatus) => {
        workspace.health = nextStatus;
        workspace.status = nextStatus;
      },
      onPort: (port) => {
        this.#recordEvent(id, 'PortDiscovered', { id, ...port });
      }
    });

    workspace.runtime = artifact.runtime;
    const runtime = await provider.execute(artifact);
    this.runtimeInstances.set(id, runtime);

    try {
      await runtime.start();
      workspace.status = await runtime.health();
      workspace.health = workspace.status;
    } catch (error) {
      workspace.status = WorkspaceStatus.Failed;
      workspace.health = WorkspaceStatus.Failed;
      this.#recordEvent(id, 'WorkspaceFailed', { id, reason: error.message });
      throw error;
    }

    return workspace;
  }

  async stop(id) {
    const ws = this.#mustGetWorkspace(id);
    const runtime = this.#mustGetRuntime(id);
    await runtime.stop();
    ws.status = WorkspaceStatus.Stopped;
    ws.health = WorkspaceStatus.Stopped;
    this.#recordEvent(id, 'WorkspaceStopped', { id });
  }

  async restart(id) {
    const ws = this.#mustGetWorkspace(id);
    const runtime = this.#mustGetRuntime(id);
    await runtime.restart();
    ws.status = await runtime.health();
    ws.health = ws.status;
    this.#recordEvent(id, 'WorkspaceRestarted', { id });
    return ws;
  }

  logs(id) {
    this.#mustGetWorkspace(id);
    return this.#mustGetRuntime(id).logs();
  }

  getLogs(id, limit = 200) {
    this.#mustGetWorkspace(id);
    return this.#mustGetRuntime(id).getRecentLogs(limit);
  }

  async events(id) {
    this.#mustGetWorkspace(id);
    return [...(this.workspaceEvents.get(id) ?? [])];
  }

  filesystem(id) {
    this.#mustGetWorkspace(id);
    return this.#mustGetRuntime(id).filesystem();
  }

  async ports(id) {
    this.#mustGetWorkspace(id);
    return this.#mustGetRuntime(id).ports();
  }

  list() {
    return [...this.workspaces.values()];
  }

  async health(id) {
    const ws = this.#mustGetWorkspace(id);
    const runtime = this.#mustGetRuntime(id);
    ws.health = await runtime.health();
    ws.status = ws.health;
    return ws.health;
  }

  #mustGetWorkspace(id) {
    const ws = this.workspaces.get(id);
    if (!ws) {
      throw new Error(`Workspace not found: ${id}`);
    }
    return ws;
  }

  #mustGetRuntime(id) {
    const runtime = this.runtimeInstances.get(id);
    if (!runtime) {
      throw new Error(`Runtime not found for workspace: ${id}`);
    }
    return runtime;
  }

  #recordEvent(id, type, payload = {}) {
    const events = this.workspaceEvents.get(id);
    if (!events) {
      return;
    }

    const event = {
      type,
      timestamp: new Date().toISOString(),
      ...payload
    };

    events.push(event);
    if (events.length > MAX_EVENT_HISTORY) {
      events.shift();
    }
  }
}

export function createWasmWorkspace(options = {}) {
  return new InMemoryWasmWorkspace(options);
}
