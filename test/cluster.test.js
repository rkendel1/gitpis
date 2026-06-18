import test from 'node:test';
import assert from 'node:assert/strict';
import {
  InMemoryWorkerRegistry,
  Scheduler,
  ResourceManager,
  InMemoryClusterStateStore,
  InMemoryWorkQueue,
  LeastLoadedPlacementStrategy,
  MigrationManager,
  NodeStatus
} from '../src/cluster.js';

test('Scheduler places workspace on least-loaded healthy node and tracks location', async () => {
  const registry = new InMemoryWorkerRegistry();
  registry.register({ id: 'worker-1', cpuAvailable: 20, memoryAvailable: 512, diskAvailable: 100, workspaceCount: 3, status: NodeStatus.Healthy });
  registry.register({ id: 'worker-2', cpuAvailable: 70, memoryAvailable: 256, diskAvailable: 100, workspaceCount: 1, status: NodeStatus.Healthy });

  const stateStore = new InMemoryClusterStateStore();
  const resourceManager = new ResourceManager({ registry });
  const scheduler = new Scheduler({ registry, stateStore, resourceManager, placementStrategy: new LeastLoadedPlacementStrategy() });

  const assignment = await scheduler.schedule({ workspaceId: 'ws-1', tenantId: 'tenant-a', resources: { cpu: 5, memory: 64, disk: 1 } });
  assert.equal(assignment.workerId, 'worker-2');
  assert.deepEqual(stateStore.getWorkspaceLocation('ws-1'), { workspaceId: 'ws-1', nodeId: 'worker-2' });
  assert.equal(registry.get('worker-2')?.cpuAvailable, 65);
  assert.equal(registry.get('worker-2')?.memoryAvailable, 192);
  assert.equal(registry.get('worker-2')?.diskAvailable, 99);

  await scheduler.release('ws-1');
  assert.equal(stateStore.getWorkspaceLocation('ws-1'), null);
});

test('Worker registry marks nodes offline when heartbeat expires', () => {
  let simulatedTime = 1_000;
  const registry = new InMemoryWorkerRegistry({ heartbeatTimeoutMs: 5000, now: () => simulatedTime });
  registry.register({ id: 'worker-1', cpuAvailable: 50, memoryAvailable: 50, diskAvailable: 50, workspaceCount: 0, status: NodeStatus.Healthy });

  simulatedTime += 2000;
  registry.heartbeat('worker-1', { cpu: 48, memory: 49, disk: 47, workspaces: 1 });
  assert.equal(registry.get('worker-1')?.status, NodeStatus.Healthy);

  simulatedTime += 6000;
  assert.equal(registry.get('worker-1')?.status, NodeStatus.Offline);
});

test('Work queue retries and dead-letters saturated items', () => {
  const queue = new InMemoryWorkQueue({ maxRetries: 1 });
  queue.enqueue({ kind: 'launch', workspaceId: 'ws-1' });

  const dequeued = queue.dequeue();
  const firstRetry = queue.retry(dequeued, new Error('transient'));
  assert.equal(firstRetry.attempts, 1);
  const dequeuedRetry = queue.dequeue();
  assert.equal(dequeuedRetry.id, firstRetry.id);

  const deadLetter = queue.retry(dequeuedRetry, new Error('still failing'));
  assert.equal(deadLetter.reason, 'still failing');
  assert.equal(queue.deadLetters.length, 1);
  assert.equal(queue.queue.length, 0);
  assert.equal(queue.deadLetters[0].id, firstRetry.id);
});

test('Migration manager updates workspace ownership', async () => {
  const registry = new InMemoryWorkerRegistry();
  registry.register({ id: 'worker-a', cpuAvailable: 50, memoryAvailable: 500, diskAvailable: 50, workspaceCount: 0, status: NodeStatus.Healthy });
  registry.register({ id: 'worker-b', cpuAvailable: 50, memoryAvailable: 500, diskAvailable: 50, workspaceCount: 0, status: NodeStatus.Healthy });

  const stateStore = new InMemoryClusterStateStore();
  stateStore.saveWorkspace({ workspaceId: 'ws-2', tenantId: 'tenant-a', resources: { cpu: 10, memory: 128, disk: 2 } });
  stateStore.saveWorkspaceLocation({ workspaceId: 'ws-2', nodeId: 'worker-a' });

  const resourceManager = new ResourceManager({ registry });
  resourceManager.allocate({ workspaceId: 'ws-2', nodeId: 'worker-a', resources: { cpu: 10, memory: 128, disk: 2 } });

  const migrationManager = new MigrationManager({ registry, stateStore, resourceManager });
  const location = await migrationManager.migrate('ws-2', 'worker-b');

  assert.deepEqual(location, { workspaceId: 'ws-2', nodeId: 'worker-b' });
});
