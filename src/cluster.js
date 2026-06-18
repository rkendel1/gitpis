import { randomUUID } from 'node:crypto';

export const NodeStatus = {
  Healthy: 'healthy',
  Draining: 'draining',
  Offline: 'offline'
};

const DEFAULT_RESOURCES = Object.freeze({ cpu: 1, memory: 256, disk: 1, network: 0, runtimeCount: 1 });

function withDefaults(resources = {}) {
  return {
    cpu: Number(resources.cpu ?? DEFAULT_RESOURCES.cpu),
    memory: Number(resources.memory ?? DEFAULT_RESOURCES.memory),
    disk: Number(resources.disk ?? DEFAULT_RESOURCES.disk),
    network: Number(resources.network ?? DEFAULT_RESOURCES.network),
    runtimeCount: Number(resources.runtimeCount ?? DEFAULT_RESOURCES.runtimeCount)
  };
}

export class InMemoryWorkerRegistry {
  constructor(options = {}) {
    this.nodes = new Map();
    this.heartbeatTimeoutMs = options.heartbeatTimeoutMs ?? 15_000;
    this.now = options.now ?? (() => Date.now());
  }

  register(node) {
    const current = this.nodes.get(node.id);
    this.nodes.set(node.id, {
      ...current,
      ...node,
      status: node.status ?? current?.status ?? NodeStatus.Healthy,
      lastHeartbeatAt: this.now()
    });
  }

  unregister(nodeId) {
    this.nodes.delete(nodeId);
  }

  heartbeat(nodeId, metrics = {}) {
    const node = this.nodes.get(nodeId);
    if (!node) {
      return;
    }

    this.nodes.set(nodeId, {
      ...node,
      cpuAvailable: Number(metrics.cpu ?? node.cpuAvailable),
      memoryAvailable: Number(metrics.memory ?? node.memoryAvailable),
      diskAvailable: Number(metrics.disk ?? node.diskAvailable),
      workspaceCount: Number(metrics.workspaces ?? node.workspaceCount),
      status: node.status === NodeStatus.Draining ? NodeStatus.Draining : NodeStatus.Healthy,
      lastHeartbeatAt: this.now()
    });
  }

  setStatus(nodeId, status) {
    const node = this.nodes.get(nodeId);
    if (!node) {
      return;
    }
    this.nodes.set(nodeId, { ...node, status });
  }

  get(nodeId) {
    const node = this.nodes.get(nodeId);
    if (!node) {
      return null;
    }
    return this.#withComputedStatus(node);
  }

  list() {
    return [...this.nodes.values()].map((node) => this.#withComputedStatus(node));
  }

  #withComputedStatus(node) {
    if (node.status === NodeStatus.Draining) {
      return { ...node };
    }

    const isOffline = this.now() - node.lastHeartbeatAt > this.heartbeatTimeoutMs;
    return {
      ...node,
      status: isOffline ? NodeStatus.Offline : NodeStatus.Healthy
    };
  }
}

export class LeastLoadedPlacementStrategy {
  selectNode(nodes) {
    const sorted = [...nodes].sort((a, b) => b.cpuAvailable - a.cpuAvailable);
    return sorted[0] ?? null;
  }
}

export class MemoryAwarePlacementStrategy {
  selectNode(nodes) {
    const sorted = [...nodes].sort((a, b) => b.memoryAvailable - a.memoryAvailable);
    return sorted[0] ?? null;
  }
}

export class BinPackingPlacementStrategy {
  selectNode(nodes, request = {}) {
    const resources = withDefaults(request.resources);
    const candidates = nodes
      .filter((node) => node.cpuAvailable >= resources.cpu && node.memoryAvailable >= resources.memory && node.diskAvailable >= resources.disk)
      .sort((a, b) => {
        const aSlack = (a.cpuAvailable - resources.cpu) + (a.memoryAvailable - resources.memory) + (a.diskAvailable - resources.disk);
        const bSlack = (b.cpuAvailable - resources.cpu) + (b.memoryAvailable - resources.memory) + (b.diskAvailable - resources.disk);
        return aSlack - bSlack;
      });

    return candidates[0] ?? null;
  }
}

export class CostOptimizedPlacementStrategy {
  selectNode(nodes) {
    const sorted = [...nodes].sort((a, b) => (a.costPerHour ?? Number.MAX_SAFE_INTEGER) - (b.costPerHour ?? Number.MAX_SAFE_INTEGER));
    return sorted[0] ?? null;
  }
}

export class ResourceManager {
  constructor(options = {}) {
    this.allocations = new Map();
    this.registry = options.registry;
  }

  allocate({ workspaceId, nodeId, resources = {} }) {
    if (this.allocations.has(workspaceId)) {
      throw new Error(`Resources already allocated for workspace: ${workspaceId}`);
    }

    const node = this.registry.get(nodeId);
    if (!node) {
      throw new Error(`Worker node not found: ${nodeId}`);
    }

    const requested = withDefaults(resources);
    if (node.cpuAvailable < requested.cpu || node.memoryAvailable < requested.memory || node.diskAvailable < requested.disk) {
      throw new Error(`Insufficient capacity on worker node: ${nodeId}`);
    }

    this.registry.register({
      ...node,
      cpuAvailable: node.cpuAvailable - requested.cpu,
      memoryAvailable: node.memoryAvailable - requested.memory,
      diskAvailable: node.diskAvailable - requested.disk,
      workspaceCount: (node.workspaceCount ?? 0) + requested.runtimeCount,
      status: node.status
    });

    this.allocations.set(workspaceId, {
      workspaceId,
      nodeId,
      resources: requested,
      allocatedAt: new Date().toISOString()
    });

    return this.allocations.get(workspaceId);
  }

  release(workspaceId) {
    const existing = this.allocations.get(workspaceId);
    if (!existing) {
      return;
    }

    const node = this.registry.get(existing.nodeId);
    if (node) {
      this.registry.register({
        ...node,
        cpuAvailable: node.cpuAvailable + existing.resources.cpu,
        memoryAvailable: node.memoryAvailable + existing.resources.memory,
        diskAvailable: node.diskAvailable + existing.resources.disk,
        workspaceCount: Math.max(0, (node.workspaceCount ?? 0) - existing.resources.runtimeCount),
        status: node.status
      });
    }

    this.allocations.delete(workspaceId);
  }

  rebalance() {
    return {
      activeAllocations: this.allocations.size,
      nodes: this.registry.list()
    };
  }
}

export class InMemoryWorkQueue {
  constructor(options = {}) {
    this.maxRetries = options.maxRetries ?? 3;
    this.queue = [];
    this.deadLetters = [];
  }

  enqueue(payload) {
    const item = {
      id: randomUUID(),
      payload,
      attempts: 0,
      enqueuedAt: new Date().toISOString()
    };
    this.queue.push(item);
    return item;
  }

  dequeue() {
    return this.queue.shift() ?? null;
  }

  retry(item, error = null) {
    const attempts = Number(item.attempts ?? 0) + 1;
    if (attempts > this.maxRetries) {
      return this.deadLetter({ ...item, attempts }, error?.message ?? String(error ?? 'retry limit exceeded'));
    }

    const next = { ...item, attempts };
    this.queue.push(next);
    return next;
  }

  deadLetter(item, reason = 'failed') {
    const entry = {
      ...item,
      failedAt: new Date().toISOString(),
      reason
    };
    this.deadLetters.push(entry);
    return entry;
  }
}

export class InMemoryClusterStateStore {
  constructor() {
    this.workspaces = new Map();
    this.nodes = new Map();
    this.workspaceLocations = new Map();
  }

  saveWorkspace(workspace) {
    this.workspaces.set(workspace.workspaceId, { ...workspace });
  }

  getWorkspace(workspaceId) {
    return this.workspaces.get(workspaceId) ?? null;
  }

  saveNode(node) {
    this.nodes.set(node.id, { ...node });
  }

  getNodes() {
    return [...this.nodes.values()].map((node) => ({ ...node }));
  }

  saveWorkspaceLocation(location) {
    this.workspaceLocations.set(location.workspaceId, { ...location });
  }

  getWorkspaceLocation(workspaceId) {
    return this.workspaceLocations.get(workspaceId) ?? null;
  }

  removeWorkspaceLocation(workspaceId) {
    this.workspaceLocations.delete(workspaceId);
  }
}

export class TenantQuotaManager {
  constructor(options = {}) {
    this.quotas = new Map();
    this.workspaceCounts = new Map();
    this.defaultQuota = options.defaultQuota ?? { maxWorkspaces: Number.MAX_SAFE_INTEGER, maxCpu: Number.MAX_SAFE_INTEGER, maxMemory: Number.MAX_SAFE_INTEGER };
  }

  setQuota(tenantId, quota) {
    this.quotas.set(tenantId, { ...quota });
  }

  canSchedule(tenantId) {
    const quota = this.quotas.get(tenantId) ?? this.defaultQuota;
    const count = this.workspaceCounts.get(tenantId) ?? 0;
    return count < quota.maxWorkspaces;
  }

  increment(tenantId) {
    this.workspaceCounts.set(tenantId, (this.workspaceCounts.get(tenantId) ?? 0) + 1);
  }

  decrement(tenantId) {
    this.workspaceCounts.set(tenantId, Math.max(0, (this.workspaceCounts.get(tenantId) ?? 0) - 1));
  }
}

export class Scheduler {
  constructor(options = {}) {
    this.registry = options.registry ?? new InMemoryWorkerRegistry();
    this.resourceManager = options.resourceManager ?? new ResourceManager({ registry: this.registry });
    this.stateStore = options.stateStore ?? new InMemoryClusterStateStore();
    this.placementStrategy = options.placementStrategy ?? new LeastLoadedPlacementStrategy();
    this.tenantQuotaManager = options.tenantQuotaManager ?? new TenantQuotaManager();
  }

  async schedule(request) {
    const workspaceId = request.workspaceId ?? randomUUID();
    const tenantId = request.tenantId ?? 'default';

    if (!this.tenantQuotaManager.canSchedule(tenantId)) {
      throw new Error(`Tenant quota exceeded: ${tenantId}`);
    }

    const nodes = this.registry.list().filter((node) => node.status === NodeStatus.Healthy);
    if (nodes.length === 0) {
      throw new Error('No healthy worker nodes available');
    }

    const selected = this.placementStrategy.selectNode(nodes, request);
    if (!selected) {
      throw new Error('No suitable worker node found');
    }

    this.resourceManager.allocate({
      workspaceId,
      nodeId: selected.id,
      resources: request.resources
    });

    const assignment = {
      workspaceId,
      workerId: selected.id,
      nodeId: selected.id,
      address: selected.address ?? null,
      tenantId,
      scheduledAt: new Date().toISOString()
    };

    this.tenantQuotaManager.increment(tenantId);
    this.stateStore.saveWorkspace({ workspaceId, tenantId, resources: withDefaults(request.resources) });
    this.stateStore.saveWorkspaceLocation({ workspaceId, nodeId: selected.id });

    return assignment;
  }

  async reschedule(workspaceId) {
    const workspace = this.stateStore.getWorkspace(workspaceId);
    if (!workspace) {
      throw new Error(`Workspace not found: ${workspaceId}`);
    }

    this.resourceManager.release(workspaceId);
    this.stateStore.removeWorkspaceLocation(workspaceId);

    return this.schedule({
      workspaceId,
      tenantId: workspace.tenantId,
      resources: workspace.resources
    });
  }

  async release(workspaceId) {
    const workspace = this.stateStore.getWorkspace(workspaceId);
    this.resourceManager.release(workspaceId);
    this.stateStore.removeWorkspaceLocation(workspaceId);
    if (workspace?.tenantId) {
      this.tenantQuotaManager.decrement(workspace.tenantId);
    }
  }
}

export class RecoveryManager {
  constructor(options = {}) {
    this.scheduler = options.scheduler;
    this.stateStore = options.stateStore;
  }

  async recoverWorkspace(workspaceId) {
    const current = this.stateStore.getWorkspaceLocation(workspaceId);
    if (!current) {
      throw new Error(`No workspace location found: ${workspaceId}`);
    }

    return this.scheduler.reschedule(workspaceId);
  }
}

export class MigrationManager {
  constructor(options = {}) {
    this.registry = options.registry;
    this.stateStore = options.stateStore;
    this.resourceManager = options.resourceManager;
  }

  async migrate(workspaceId, destinationNode) {
    const workspace = this.stateStore.getWorkspace(workspaceId);
    if (!workspace) {
      throw new Error(`Workspace not found: ${workspaceId}`);
    }

    const destination = this.registry.get(destinationNode);
    if (!destination || destination.status !== NodeStatus.Healthy) {
      throw new Error(`Destination node unavailable: ${destinationNode}`);
    }

    this.resourceManager.release(workspaceId);
    this.resourceManager.allocate({
      workspaceId,
      nodeId: destinationNode,
      resources: workspace.resources
    });
    this.stateStore.saveWorkspaceLocation({ workspaceId, nodeId: destinationNode });

    return this.stateStore.getWorkspaceLocation(workspaceId);
  }
}

export class DrainManager {
  constructor(options = {}) {
    this.registry = options.registry;
    this.stateStore = options.stateStore;
    this.migrationManager = options.migrationManager;
  }

  async drain(workerId) {
    this.registry.setStatus(workerId, NodeStatus.Draining);
    const locations = [];
    for (const workspace of this.stateStore.workspaces.values()) {
      const location = this.stateStore.getWorkspaceLocation(workspace.workspaceId);
      if (location?.nodeId === workerId) {
        locations.push(workspace.workspaceId);
      }
    }

    return {
      workerId,
      status: NodeStatus.Draining,
      affectedWorkspaces: locations,
      migrated: []
    };
  }
}

export class Autoscaler {
  scaleUp(metrics = {}) {
    return {
      action: metrics.cpuUsage > 80 || metrics.queueDepth > 500 ? 'scale_up' : 'stable',
      reason: metrics.cpuUsage > 80 ? 'cpu_threshold' : metrics.queueDepth > 500 ? 'queue_depth' : 'within_threshold'
    };
  }

  scaleDown(metrics = {}) {
    return {
      action: metrics.cpuUsage < 20 && metrics.idleMinutes >= 30 ? 'scale_down' : 'stable',
      reason: metrics.cpuUsage < 20 && metrics.idleMinutes >= 30 ? 'sustained_low_utilization' : 'within_threshold'
    };
  }
}

export class WorkerAgent {
  constructor(options = {}) {
    this.workerId = options.workerId;
    this.runtime = options.runtime;
  }

  async createWorkspace(request) {
    const workspace = await this.runtime.launch(request.repoUrl);
    return {
      ...workspace,
      workerId: this.workerId
    };
  }

  async deleteWorkspace(workspaceId) {
    await this.runtime.stop(workspaceId);
    return { ok: true, workspaceId, workerId: this.workerId };
  }

  async getWorkspace(workspaceId) {
    return this.runtime.list().find((workspace) => workspace.id === workspaceId) ?? null;
  }

  async restartWorkspace(workspaceId) {
    const workspace = await this.runtime.restart(workspaceId);
    return { ...workspace, workerId: this.workerId };
  }
}

export class LogAggregator {
  constructor() {
    this.logs = [];
  }

  ingest(entry) {
    this.logs.push({
      ...entry,
      timestamp: entry.timestamp ?? new Date().toISOString()
    });
  }

  query(filter = {}) {
    return this.logs.filter((entry) => {
      if (filter.workerId && entry.workerId !== filter.workerId) return false;
      if (filter.workspaceId && entry.workspaceId !== filter.workspaceId) return false;
      return true;
    });
  }
}

export class MetricsCollector {
  constructor() {
    this.points = [];
  }

  collect(metric) {
    this.points.push({
      ...metric,
      timestamp: metric.timestamp ?? new Date().toISOString()
    });
  }

  aggregate() {
    const totals = this.points.reduce((acc, point) => {
      for (const [key, value] of Object.entries(point)) {
        if (typeof value === 'number') {
          acc[key] = (acc[key] ?? 0) + value;
        }
      }
      return acc;
    }, {});

    return {
      samples: this.points.length,
      totals
    };
  }
}

export function createClusterScheduler(options = {}) {
  const registry = options.registry ?? new InMemoryWorkerRegistry();
  const stateStore = options.stateStore ?? new InMemoryClusterStateStore();
  const resourceManager = options.resourceManager ?? new ResourceManager({ registry });
  const tenantQuotaManager = options.tenantQuotaManager ?? new TenantQuotaManager();
  const scheduler = new Scheduler({
    registry,
    stateStore,
    resourceManager,
    tenantQuotaManager,
    placementStrategy: options.placementStrategy
  });

  return {
    scheduler,
    registry,
    stateStore,
    resourceManager,
    tenantQuotaManager,
    workQueue: options.workQueue ?? new InMemoryWorkQueue(),
    recoveryManager: new RecoveryManager({ scheduler, stateStore }),
    migrationManager: new MigrationManager({ registry, stateStore, resourceManager }),
    autoscaler: new Autoscaler(),
    logAggregator: options.logAggregator ?? new LogAggregator(),
    metricsCollector: options.metricsCollector ?? new MetricsCollector()
  };
}
