import path from 'node:path';
import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { cloneRepository, analyzeRepository } from './repository.js';
import { detectFramework, generateExecutionPlan } from './frameworkDetector.js';
import { RuntimeProviderRegistry, NodeRuntimeProvider, WasmtimeProvider, defaultRuntimeCandidates, defaultResourceLimits } from './providers.js';
import { WorkspaceFileSystem } from './filesystem.js';
import { FilesystemJournal, LocalSnapshotStorageProvider, SnapshotEngine } from './persistence.js';
import { NetworkingManager } from './networking.js';
import { InMemoryIdeProvider, WorkspaceFileService, WorkspaceTerminalService, WorkspaceGitService, WorkspaceSocket, IdeEventBus, FileRevisionStore, InMemoryLspGateway, IdeStateManager } from './ide.js';

const WORKSPACE_BASE = path.resolve('.wasm-workspaces');
const RUNTIME_DIR = 'runtime';
const WORKSPACE_DIR = 'workspace';
const MAX_EVENT_HISTORY = 500;
const SNAPSHOT_ROOT_DIR = '.snapshots';

export const WorkspaceStatus = {
  Starting: 'starting',
  Installing: 'installing',
  Building: 'building',
  Running: 'running',
  Suspended: 'suspended',
  Restoring: 'restoring',
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
    this.nodeProvider = new NodeRuntimeProvider();
    this.registry.register(this.nodeProvider);
    this.registry.register(new WasmtimeProvider());
    this.runtimeCandidates = defaultRuntimeCandidates();
    this.resourceLimits = options.resourceLimits ?? defaultResourceLimits();
    this.workspaceJournals = new Map();
    this.networkingManager = options.networkingManager ?? new NetworkingManager({
      baseDomain: options.baseDomain
    });
    const snapshotStorageProvider = options.snapshotStorageProvider ?? new LocalSnapshotStorageProvider({
      baseDir: path.join(this.workspaceBase, SNAPSHOT_ROOT_DIR)
    });
    this.snapshotEngine = options.snapshotEngine ?? new SnapshotEngine({
      storageProvider: snapshotStorageProvider,
      compression: options.snapshotCompression ?? 'zstd'
    });
    this.ideProvider = options.ideProvider ?? new InMemoryIdeProvider();
    this.ideEventBusLayer = options.ideEventBus ?? new IdeEventBus();
    this.fileRevisionStoreLayer = options.fileRevisionStore ?? new FileRevisionStore();
    this.lspGatewayLayer = options.lspGateway ?? new InMemoryLspGateway();
    this.ideStateManagerLayer = options.ideStateManager ?? new IdeStateManager();
    this.fileServiceLayer = options.fileService ?? new WorkspaceFileService(this, {
      eventBus: this.ideEventBusLayer,
      revisionStore: this.fileRevisionStoreLayer
    });
    this.terminalServiceLayer = options.terminalService ?? new WorkspaceTerminalService(this, {
      eventBus: this.ideEventBusLayer
    });
    this.gitServiceLayer = options.gitService ?? new WorkspaceGitService(this, {
      eventBus: this.ideEventBusLayer
    });
    this.socketGateway = options.workspaceSocket ?? new WorkspaceSocket();
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
      resourceLimits: { ...this.resourceLimits },
      environmentVariables: {},
      latestSnapshotId: null
    };

    this.workspaces.set(id, workspace);
    this.workspaceJournals.set(id, new FilesystemJournal());
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
        this.#syncRoutesForWorkspace(id).catch((error) => {
          this.#recordEvent(id, 'RouteSyncFailed', { id, reason: error.message });
        });
      }
    });

    workspace.runtime = artifact.runtime;
    workspace.packageManager = artifact.packageManager;
    workspace.dependencyHash = artifact.dependencyHash ?? '';
    workspace.environmentVariables = { ...(artifact.environment ?? {}) };
    const runtime = await provider.execute(artifact);
    this.runtimeInstances.set(id, runtime);

    try {
      await runtime.start();
      workspace.status = await runtime.health();
      workspace.health = workspace.status;
      await this.#syncRoutesForWorkspace(id);
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
    await this.networkingManager.releaseRoute(id);
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
    const runtime = this.runtimeInstances.get(id);
    if (!runtime) {
      return (async function *empty() {})();
    }
    return runtime.logs();
  }

  getLogs(id, limit = 200) {
    this.#mustGetWorkspace(id);
    const runtime = this.runtimeInstances.get(id);
    return runtime ? runtime.getRecentLogs(limit) : [];
  }

  async events(id) {
    this.#mustGetWorkspace(id);
    return [...(this.workspaceEvents.get(id) ?? [])];
  }

  filesystem(id) {
    const ws = this.#mustGetWorkspace(id);
    const runtime = this.runtimeInstances.get(id);
    if (runtime) {
      return runtime.filesystem();
    }
    const journal = this.workspaceJournals.get(id);
    return new WorkspaceFileSystem(ws.repoPath, { journal });
  }

  async ports(id) {
    this.#mustGetWorkspace(id);
    const runtime = this.runtimeInstances.get(id);
    const ports = runtime ? await runtime.ports() : [];
    await this.#syncRoutesForWorkspace(id, ports);
    return ports;
  }

  list() {
    return [...this.workspaces.values()];
  }

  async health(id) {
    const ws = this.#mustGetWorkspace(id);
    const runtime = this.runtimeInstances.get(id);
    if (runtime) {
      ws.health = await runtime.health();
      ws.status = ws.health;
    }
    return ws.health;
  }

  async snapshot(id) {
    const ws = this.#mustGetWorkspace(id);
    const runtime = this.runtimeInstances.get(id);
    let previousSnapshot = null;
    if (ws.latestSnapshotId) {
      try {
        previousSnapshot = await this.snapshotEngine.storage.load(ws.latestSnapshotId);
      } catch (error) {
        this.#recordEvent(id, 'WorkspaceSnapshotMissing', {
          id,
          snapshotId: ws.latestSnapshotId,
          reason: error.message
        });
      }

    }
    const runtimePorts = runtime ? await runtime.ports().catch(() => []) : [];
    const snapshot = await this.snapshotEngine.create(id, {
      workspacePath: ws.repoPath,
      previousSnapshot,
      environmentVariables: ws.environmentVariables ?? {},
      runtimeMetadata: {
        framework: ws.framework,
        packageManager: ws.packageManager ?? 'unknown',
        dependencyHash: ws.dependencyHash ?? '',
        buildHash: ws.buildHash ?? '',
        ports: runtimePorts
      }
    });
    ws.latestSnapshotId = snapshot.id;
    this.#recordEvent(id, 'WorkspaceSnapshotCreated', { id, snapshotId: snapshot.id });
    return snapshot;
  }

  async suspend(id) {
    const ws = this.#mustGetWorkspace(id);
    const snapshot = await this.snapshot(id);
    const runtime = this.runtimeInstances.get(id);
    if (runtime) {
      await runtime.stop();
      this.runtimeInstances.delete(id);
    }
    ws.status = WorkspaceStatus.Suspended;
    ws.health = WorkspaceStatus.Suspended;
    this.#recordEvent(id, 'WorkspaceSuspended', { id, snapshotId: snapshot.id });
    return ws;
  }

  async resume(id) {
    const ws = this.#mustGetWorkspace(id);
    if (this.runtimeInstances.has(id)) {
      ws.health = await this.runtimeInstances.get(id).health();
      ws.status = ws.health;
      return ws;
    }

    ws.status = WorkspaceStatus.Restoring;
    ws.health = WorkspaceStatus.Restoring;
    this.#recordEvent(id, 'WorkspaceRestoring', { id, snapshotId: ws.latestSnapshotId ?? null });

    if (ws.latestSnapshotId) {
      await this.snapshotEngine.restore(ws.latestSnapshotId, ws.repoPath);
    }

    const provider = await this.#providerForWorkspace(ws);
    const artifact = await provider.build({
      ...(await analyzeRepository(ws.repoPath)),
      path: ws.repoPath,
      framework: ws.framework,
      executionPlan: ws.executionPlan,
      workspaceId: id,
      resourceLimits: ws.resourceLimits,
      environment: ws.environmentVariables ?? {},
      onEvent: (event) => this.#recordEvent(id, event.type, event),
      onHealth: (nextStatus) => {
        ws.health = nextStatus;
        ws.status = nextStatus;
      },
      onPort: (port) => {
        this.#recordEvent(id, 'PortDiscovered', { id, ...port });
        this.#syncRoutesForWorkspace(id).catch((error) => {
          this.#recordEvent(id, 'RouteSyncFailed', { id, reason: error.message });
        });
      }
    });

    ws.runtime = artifact.runtime;
    ws.packageManager = artifact.packageManager ?? ws.packageManager;
    ws.dependencyHash = artifact.dependencyHash ?? ws.dependencyHash;
    ws.environmentVariables = { ...(artifact.environment ?? ws.environmentVariables ?? {}) };

    const runtime = await provider.execute(artifact);
    this.runtimeInstances.set(id, runtime);
    await runtime.start();
    ws.status = await runtime.health();
    ws.health = ws.status;
    await this.#syncRoutesForWorkspace(id);
    this.#recordEvent(id, 'WorkspaceResumed', { id, snapshotId: ws.latestSnapshotId ?? null });
    return ws;
  }

  async listSnapshots(id) {
    this.#mustGetWorkspace(id);
    return this.snapshotEngine.list(id);
  }

  async restore(id, snapshotId) {
    const ws = this.#mustGetWorkspace(id);
    const runtime = this.runtimeInstances.get(id);
    if (runtime) {
      await runtime.stop();
      this.runtimeInstances.delete(id);
    }
    ws.status = WorkspaceStatus.Restoring;
    ws.health = WorkspaceStatus.Restoring;
    await this.snapshotEngine.restore(snapshotId, ws.repoPath);
    ws.latestSnapshotId = snapshotId;
    this.#recordEvent(id, 'WorkspaceSnapshotRestored', { id, snapshotId });
    return this.resume(id);
  }

  cacheStats() {
    const stats = this.nodeProvider?.cacheStats?.() ?? {};
    return {
      dependencyHitRate: stats.dependencyHitRate ?? 0,
      buildHitRate: stats.buildHitRate ?? 0,
      cacheSizeGb: 0,
      ...stats
    };
  }

  async routes(id) {
    this.#mustGetWorkspace(id);
    await this.#syncRoutesForWorkspace(id);
    return this.networkingManager.routes(id);
  }

  async createRoute(id, port) {
    this.#mustGetWorkspace(id);
    const runtime = this.runtimeInstances.get(id);
    const ports = runtime ? await runtime.ports() : [];
    const selectedPort = Number(port ?? ports[0]?.port ?? 0);
    if (!selectedPort) {
      throw new Error(`No port available for workspace: ${id}`);
    }
    return this.networkingManager.allocateRoute(id, selectedPort);
  }

  async deleteRoute(id, routeId) {
    this.#mustGetWorkspace(id);
    await this.networkingManager.releaseRoute(id, routeId);
  }

  async networkRoutes() {
    return this.networkingManager.allRoutes();
  }

  async networkStats() {
    return this.networkingManager.stats();
  }

  async workspaceNetwork(id) {
    this.#mustGetWorkspace(id);
    const runtime = this.runtimeInstances.get(id);
    return this.networkingManager.workspaceNetwork(id, runtime);
  }

  async workspaceUrl(id) {
    this.#mustGetWorkspace(id);
    await this.#syncRoutesForWorkspace(id);
    return this.networkingManager.url(id);
  }

  async workspaceDomains(id) {
    this.#mustGetWorkspace(id);
    return this.networkingManager.domains(id);
  }

  async initializeIdeSession(workspaceId, userId = 'anonymous') {
    this.#mustGetWorkspace(workspaceId);
    return this.ideProvider.initialize(workspaceId, userId);
  }

  async destroyIdeSession(sessionId) {
    await this.ideProvider.destroy(sessionId);
  }

  fileService() {
    return this.fileServiceLayer;
  }

  terminalService() {
    return this.terminalServiceLayer;
  }

  gitService() {
    return this.gitServiceLayer;
  }

  workspaceSocket() {
    return this.socketGateway;
  }

  ideEventBus() {
    return this.ideEventBusLayer;
  }

  ideEvents(workspaceId, fromTimestamp = 0) {
    return this.ideEventBusLayer.replay(workspaceId, fromTimestamp);
  }

  appendIdeEvent(workspaceId, type, payload = {}) {
    this.#mustGetWorkspace(workspaceId);
    return this.ideEventBusLayer.append(workspaceId, type, payload);
  }

  lspGateway() {
    return this.lspGatewayLayer;
  }

  ideState(workspaceId) {
    this.#mustGetWorkspace(workspaceId);
    return this.ideStateManagerLayer.snapshot(workspaceId);
  }

  updateIdeState(workspaceId, patch) {
    this.#mustGetWorkspace(workspaceId);
    return this.ideStateManagerLayer.update(workspaceId, patch);
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

  async #providerForWorkspace(workspace) {
    const analysis = await analyzeRepository(workspace.repoPath);
    const provider = this.registry.findCompatible({
      ...analysis,
      framework: workspace.framework
    });
    if (!provider) {
      throw new Error(`No compatible runtime provider for framework: ${workspace.framework}`);
    }
    return provider;
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

  async #syncRoutesForWorkspace(id, providedPorts) {
    const runtime = this.runtimeInstances.get(id);
    const ports = providedPorts ?? (runtime ? await runtime.ports() : []);
    for (const portInfo of ports) {
      await this.networkingManager.allocateRoute(id, portInfo.port);
    }
  }
}

export function createWasmWorkspace(options = {}) {
  return new InMemoryWasmWorkspace(options);
}

export { SnapshotEngine, LocalSnapshotStorageProvider, FilesystemJournal } from './persistence.js';
export * from './ide.js';
export * from './cluster.js';
