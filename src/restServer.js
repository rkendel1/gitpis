import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { createWasmWorkspace, createClusterScheduler, WorkerAgent, NodeStatus } from './index.js';

function json(res, status, payload) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(payload));
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

export function createRestServer(options = {}) {
  const workspace = options.workspace ?? createWasmWorkspace();
  const cluster = options.cluster ?? createClusterScheduler();
  const workerId = options.workerId ?? 'worker-local';
  const workerAgent = options.workerAgent ?? new WorkerAgent({ workerId, runtime: workspace });

  if (!cluster.registry.get(workerId)) {
    cluster.registry.register({
      id: workerId,
      cpuAvailable: 100,
      memoryAvailable: 100,
      diskAvailable: 100,
      workspaceCount: 0,
      status: NodeStatus.Healthy,
      address: '127.0.0.1'
    });
    cluster.stateStore.saveNode(cluster.registry.get(workerId));
  }

  return http.createServer(async (req, res) => {
    try {
      const parsedUrl = new URL(req.url ?? '/', 'http://localhost');
      const pathname = parsedUrl.pathname;

      const routeDeleteMatch = pathname.match(/^\/workspaces\/([^/]+)\/routes\/([^/]+)$/);
      if (routeDeleteMatch && req.method === 'DELETE') {
        const [, id, routeId] = routeDeleteMatch;
        await workspace.deleteRoute(id, routeId);
        json(res, 200, { ok: true });
        return;
      }

      const filesMatch = pathname.match(/^\/workspaces\/([^/]+)\/files$/);
      if (filesMatch && req.method === 'GET') {
        const [, id] = filesMatch;
        const dirPath = parsedUrl.searchParams.get('path') ?? '.';
        const fileService = workspace.fileService();
        const files = await fileService.listDirectory(id, dirPath);
        json(res, 200, files);
        return;
      }

      const fileMatch = pathname.match(/^\/workspaces\/([^/]+)\/file$/);
      if (fileMatch && req.method === 'GET') {
        const [, id] = fileMatch;
        const filePath = parsedUrl.searchParams.get('path');
        if (!filePath) {
          json(res, 400, { error: 'Missing file path' });
          return;
        }
        const encoding = parsedUrl.searchParams.get('encoding') ?? 'utf8';
        const fileService = workspace.fileService();
        const content = await fileService.readFile(id, filePath, encoding);
        json(res, 200, { path: filePath, content: typeof content === 'string' ? content : content.toString('utf8') });
        return;
      }

      if (fileMatch && req.method === 'PUT') {
        const [, id] = fileMatch;
        const body = await readBody(req);
        if (!body.path) {
          json(res, 400, { error: 'Missing file path' });
          return;
        }
        const fileService = workspace.fileService();
        await fileService.writeFile(id, body.path, body.content ?? '');
        json(res, 200, { ok: true, path: body.path });
        return;
      }

      const terminalMatch = pathname.match(/^\/workspaces\/([^/]+)\/terminal$/);
      if (terminalMatch && req.method === 'POST') {
        const [, id] = terminalMatch;
        const body = await readBody(req);
        if (!body.command) {
          json(res, 400, { error: 'Missing command' });
          return;
        }
        const terminalService = workspace.terminalService();
        const terminal = await terminalService.createTerminal(id, { cwd: body.cwd });
        const result = await terminalService.execute(terminal.terminalId, body.command, body.args ?? [], {
          env: body.env,
          stdin: body.stdin
        });
        json(res, 200, { terminalId: terminal.terminalId, ...result });
        return;
      }

      const gitStatusMatch = pathname.match(/^\/workspaces\/([^/]+)\/git\/status$/);
      if (gitStatusMatch && req.method === 'GET') {
        const [, id] = gitStatusMatch;
        const gitService = workspace.gitService();
        json(res, 200, await gitService.status(id));
        return;
      }

      const gitCommitMatch = pathname.match(/^\/workspaces\/([^/]+)\/git\/commit$/);
      if (gitCommitMatch && req.method === 'POST') {
        const [, id] = gitCommitMatch;
        const body = await readBody(req);
        if (!body.message) {
          json(res, 400, { error: 'Missing commit message' });
          return;
        }
        const gitService = workspace.gitService();
        json(res, 200, await gitService.commit(id, body.message, { stageAll: body.stageAll !== false }));
        return;
      }

      const gitPushMatch = pathname.match(/^\/workspaces\/([^/]+)\/git\/push$/);
      if (gitPushMatch && req.method === 'POST') {
        const [, id] = gitPushMatch;
        const body = await readBody(req);
        const gitService = workspace.gitService();
        json(res, 200, await gitService.push(id, body.remote ?? 'origin', body.branch));
        return;
      }

      if (req.method === 'GET' && pathname === '/network/routes') {
        json(res, 200, await workspace.networkRoutes());
        return;
      }

      if (req.method === 'GET' && pathname === '/network/stats') {
        json(res, 200, await workspace.networkStats());
        return;
      }

      if (req.method === 'GET' && pathname === '/cluster/nodes') {
        json(res, 200, cluster.registry.list());
        return;
      }

      if (req.method === 'GET' && pathname === '/cluster/workspaces') {
        const locationIndex = new Map(
          cluster.stateStore.listWorkspaceLocations().map((location) => [location.workspaceId, location.nodeId])
        );
        const workspaces = workspace.list().map((item) => ({
          workspaceId: item.id,
          nodeId: locationIndex.get(item.id) ?? workerId,
          status: item.status
        }));
        json(res, 200, workspaces);
        return;
      }

      if (req.method === 'GET' && pathname === '/cluster/health') {
        const nodes = cluster.registry.list();
        json(res, 200, {
          nodes: {
            total: nodes.length,
            healthy: nodes.filter((node) => node.status === NodeStatus.Healthy).length,
            draining: nodes.filter((node) => node.status === NodeStatus.Draining).length,
            offline: nodes.filter((node) => node.status === NodeStatus.Offline).length
          },
          queueDepth: cluster.workQueue.queue.length,
          workspaces: workspace.list().length
        });
        return;
      }

      if (req.method === 'GET' && pathname === '/cluster/metrics') {
        cluster.metricsCollector.collect({
          cpu: cluster.registry.get(workerId)?.cpuAvailable ?? 0,
          memory: cluster.registry.get(workerId)?.memoryAvailable ?? 0,
          workspaceCount: workspace.list().length
        });
        json(res, 200, cluster.metricsCollector.aggregate());
        return;
      }

      if (req.method === 'POST' && pathname === '/internal/workspaces') {
        const body = await readBody(req);
        const launched = await workerAgent.createWorkspace({ repoUrl: body.repoUrl });
        const assignment = await cluster.scheduler.schedule({
          workspaceId: launched.id,
          tenantId: body.tenantId,
          repoUrl: body.repoUrl,
          resources: body.resources
        });
        cluster.stateStore.saveWorkspaceLocation({ workspaceId: launched.id, nodeId: assignment.nodeId });
        json(res, 201, { workspaceId: launched.id, workerId: assignment.workerId, workspace: launched });
        return;
      }

      const internalMatch = pathname.match(/^\/internal\/workspaces\/([^/]+)(?:\/(restart))?$/);
      if (internalMatch) {
        const [, id, action] = internalMatch;
        if (!action && req.method === 'GET') {
          const ws = await workerAgent.getWorkspace(id);
          if (!ws) {
            json(res, 404, { error: 'Not found' });
            return;
          }
          json(res, 200, ws);
          return;
        }

        if (!action && req.method === 'DELETE') {
          await workerAgent.deleteWorkspace(id);
          await cluster.scheduler.release(id);
          json(res, 200, { ok: true });
          return;
        }

        if (action === 'restart' && req.method === 'POST') {
          const restarted = await workerAgent.restartWorkspace(id);
          json(res, 200, restarted);
          return;
        }
      }

      if (req.method === 'POST' && pathname === '/workspaces') {
        const body = await readBody(req);
        const launched = await workspace.launch(body.repoUrl);
        cluster.stateStore.saveWorkspaceLocation({ workspaceId: launched.id, nodeId: workerId });
        json(res, 201, launched);
        return;
      }

      if (req.method === 'GET' && pathname === '/workspaces') {
        json(res, 200, workspace.list());
        return;
      }

      if (req.method === 'GET' && pathname === '/cache/stats') {
        json(res, 200, workspace.cacheStats());
        return;
      }

      const restoreMatch = pathname.match(/^\/workspaces\/([^/]+)\/restore\/([^/]+)$/);
      if (restoreMatch && req.method === 'POST') {
        const [, id, snapshotId] = restoreMatch;
        const restored = await workspace.restore(id, snapshotId);
        json(res, 200, restored);
        return;
      }

      const match = pathname.match(/^\/workspaces\/([^/]+)(?:\/(stop|restart|ports|health|logs|events|snapshot|suspend|resume|snapshots|routes|network))?$/);
      if (match) {
        const [, id, action] = match;

        if (!action && req.method === 'GET') {
          const item = workspace.list().find((w) => w.id === id);
          if (!item) {
            json(res, 404, { error: 'Not found' });
            return;
          }
          json(res, 200, item);
          return;
        }

        if (action === 'stop' && req.method === 'POST') {
          await workspace.stop(id);
          json(res, 200, { ok: true });
          return;
        }

        if (action === 'restart' && req.method === 'POST') {
          const restarted = await workspace.restart(id);
          json(res, 200, restarted);
          return;
        }

        if (action === 'ports' && req.method === 'GET') {
          const ports = await workspace.ports(id);
          json(res, 200, ports);
          return;
        }

        if (action === 'routes' && req.method === 'GET') {
          const routes = await workspace.routes(id);
          json(res, 200, routes);
          return;
        }

        if (action === 'routes' && req.method === 'POST') {
          const body = await readBody(req);
          const route = await workspace.createRoute(id, body.port);
          json(res, 201, route);
          return;
        }

        if (action === 'network' && req.method === 'GET') {
          const network = await workspace.workspaceNetwork(id);
          json(res, 200, network);
          return;
        }

        if (action === 'health' && req.method === 'GET') {
          const health = await workspace.health(id);
          json(res, 200, { health });
          return;
        }

        if (action === 'logs' && req.method === 'GET') {
          json(res, 200, workspace.getLogs(id));
          return;
        }

        if (action === 'events' && req.method === 'GET') {
          const events = await workspace.events(id);
          json(res, 200, events);
          return;
        }

        if (action === 'snapshot' && req.method === 'POST') {
          const snapshot = await workspace.snapshot(id);
          json(res, 201, snapshot);
          return;
        }

        if (action === 'suspend' && req.method === 'POST') {
          const suspended = await workspace.suspend(id);
          json(res, 200, suspended);
          return;
        }

        if (action === 'resume' && req.method === 'POST') {
          const resumed = await workspace.resume(id);
          json(res, 200, resumed);
          return;
        }

        if (action === 'snapshots' && req.method === 'GET') {
          const snapshots = await workspace.listSnapshots(id);
          json(res, 200, snapshots);
          return;
        }
      }

      json(res, 404, { error: 'Not found' });
    } catch (error) {
      json(res, 500, { error: error.message });
    }
  });
}

export function startRestServer(options = {}) {
  const server = createRestServer(options);
  const port = Number(options.port ?? process.env.PORT ?? 8088);
  server.listen(port, () => {
    process.stdout.write(`WASM workspace API listening on :${port}\n`);
  });
  return server;
}

const isMainModule = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMainModule) {
  startRestServer();
}
