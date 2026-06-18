import path from 'node:path';
import fs from 'node:fs/promises';
import { EventEmitter, on } from 'node:events';
import { randomUUID } from 'node:crypto';
import { cloneRepository, analyzeRepository } from './repository.js';
import { detectFramework, generateExecutionPlan } from './frameworkDetector.js';
import { WorkspaceFileSystem } from './filesystem.js';
import { derivePorts } from './networking.js';
import { RuntimeProviderRegistry, WasmtimeProvider, defaultRuntimeCandidates } from './providers.js';

const WORKSPACE_BASE = path.resolve('.wasm-workspaces');

export class InMemoryWasmWorkspace {
  constructor(options = {}) {
    this.workspaceBase = options.workspaceBase ?? WORKSPACE_BASE;
    this.workspaces = new Map();
    this.logsByWorkspace = new Map();
    this.registry = new RuntimeProviderRegistry();
    this.registry.register(new WasmtimeProvider());
    this.runtimeCandidates = defaultRuntimeCandidates();
  }

  async launch(repoUrl) {
    const id = randomUUID();
    const workspaceRoot = path.join(this.workspaceBase, id, 'repo');

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

    const artifact = await provider.build({ ...analysis, executionPlan });
    await provider.execute(artifact);

    const workspace = {
      id,
      repoUrl,
      repoPath,
      framework,
      executionPlan,
      runtime: artifact.runtime,
      status: 'running',
      createdAt: new Date().toISOString(),
      health: 'healthy'
    };

    this.workspaces.set(id, workspace);
    this.logsByWorkspace.set(id, new EventEmitter());
    this.#writeLog(id, `workspace=${id} framework=${framework} runtime=${workspace.runtime} launched`);

    return workspace;
  }

  async stop(id) {
    const ws = this.#mustGetWorkspace(id);
    ws.status = 'stopped';
    ws.health = 'stopped';
    this.#writeLog(id, `workspace=${id} stopped`);
  }

  async restart(id) {
    const ws = this.#mustGetWorkspace(id);
    ws.status = 'running';
    ws.health = 'healthy';
    this.#writeLog(id, `workspace=${id} restarted`);
    return ws;
  }

  async *logs(id) {
    this.#mustGetWorkspace(id);
    const emitter = this.logsByWorkspace.get(id);
    for await (const [line] of on(emitter, 'log')) {
      yield String(line);
    }
  }

  filesystem(id) {
    const ws = this.#mustGetWorkspace(id);
    return new WorkspaceFileSystem(ws.repoPath);
  }

  async ports(id) {
    const ws = this.#mustGetWorkspace(id);
    return derivePorts(ws.framework, ws.executionPlan);
  }

  list() {
    return [...this.workspaces.values()];
  }

  async health(id) {
    return this.#mustGetWorkspace(id).health;
  }

  #mustGetWorkspace(id) {
    const ws = this.workspaces.get(id);
    if (!ws) {
      throw new Error(`Workspace not found: ${id}`);
    }
    return ws;
  }

  #writeLog(id, line) {
    const emitter = this.logsByWorkspace.get(id);
    if (emitter) {
      emitter.emit('log', `${new Date().toISOString()} ${line}`);
    }
  }
}

export function createWasmWorkspace(options = {}) {
  return new InMemoryWasmWorkspace(options);
}
