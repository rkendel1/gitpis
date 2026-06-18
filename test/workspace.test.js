import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import { createWasmWorkspace } from '../src/index.js';

const MAX_PORT_DISCOVERY_ATTEMPTS = 30;
const MAX_HEALTH_CHECK_ATTEMPTS = 30;

async function mkRunningRepo() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gitpis-repo-'));
  const pkg = {
    name: 'demo',
    scripts: {
      build: 'node build.js',
      start: 'node start.js'
    }
  };

  await fs.writeFile(path.join(dir, 'package.json'), JSON.stringify(pkg));
  await fs.writeFile(path.join(dir, 'build.js'), 'console.log("build complete")');
  await fs.writeFile(
    path.join(dir, 'start.js'),
    [
      'console.log("ready: http://localhost:5173")',
      'setInterval(() => console.log("tick"), 250)',
      'process.on("SIGTERM", () => process.exit(0));'
    ].join('\n')
  );

  return dir;
}

async function mkFailingRepo() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gitpis-fail-repo-'));
  const pkg = {
    name: 'demo-fail',
    scripts: {
      build: 'node build.js',
      start: 'node fail.js'
    }
  };

  await fs.writeFile(path.join(dir, 'package.json'), JSON.stringify(pkg));
  await fs.writeFile(path.join(dir, 'build.js'), 'console.log("ok")');
  await fs.writeFile(path.join(dir, 'fail.js'), 'console.error("boom"); process.exit(1);');
  return dir;
}

async function nextLog(asyncIterable, timeoutMs = 3000) {
  const item = await Promise.race([
    asyncIterable.next(),
    new Promise((_, reject) => setTimeout(() => reject(new Error('Timed out waiting for log')), timeoutMs))
  ]);
  if (item.done) {
    throw new Error('Log stream ended before emitting a log line');
  }
  return item.value;
}

test('runtime launch exposes logs, ports, lifecycle, and mounted filesystem', async () => {
  const repo = await mkRunningRepo();
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'gitpis-ws-'));
  const runtime = createWasmWorkspace({ workspaceBase: base });

  let ws;

  try {
    ws = await runtime.launch(repo);
    assert.equal(ws.framework, 'node');
    assert.equal(ws.status, 'running');
    assert.equal(ws.health, 'running');
    assert.ok(ws.repoPath.endsWith(path.join('runtime', 'workspace')));

    const logStream = runtime.logs(ws.id)[Symbol.asyncIterator]();
    const firstLog = await nextLog(logStream);
    assert.equal(typeof firstLog, 'string');
    await logStream.return();

    let discovered5173 = false;
    for (let i = 0; i < MAX_PORT_DISCOVERY_ATTEMPTS; i += 1) {
      const ports = await runtime.ports(ws.id);
      if (ports.some((port) => port.port === 5173)) {
        discovered5173 = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    assert.ok(discovered5173, 'expected runtime to discover port 5173');

    const ports = await runtime.ports(ws.id);
    assert.ok(ports.some((port) => port.port === 3000));
    assert.ok(ports.some((port) => port.port === 5173));

    const routes = await runtime.routes(ws.id);
    assert.ok(routes.length >= 1);
    assert.ok(routes.some((route) => route.port === 5173));
    assert.ok(routes.every((route) => route.url.startsWith('https://')));

    const workspaceUrl = await runtime.workspaceUrl(ws.id);
    assert.equal(typeof workspaceUrl, 'string');
    assert.ok(workspaceUrl.includes('.ddockit.app'));

    const networkStats = await runtime.networkStats();
    assert.equal(typeof networkStats.RouteCount, 'number');

    const recentLogs = runtime.getLogs(ws.id);
    assert.ok(recentLogs.some((line) => line.includes('starting')));

    const events = await runtime.events(ws.id);
    assert.ok(events.some((event) => event.type === 'WorkspaceCreated'));
    assert.ok(events.some((event) => event.type === 'WorkspaceStarted'));
    assert.ok(events.some((event) => event.type === 'PortDiscovered'));

    const filesystem = await runtime.filesystem(ws.id);
    const files = await filesystem.list('.');
    assert.ok(files.includes('package.json'));

    await filesystem.writeFile('tmp/test.txt', 'ok');
    assert.equal(await filesystem.readFile('tmp/test.txt', 'utf8'), 'ok');

    await runtime.restart(ws.id);
    assert.equal(await runtime.health(ws.id), 'running');

    const cacheStats = runtime.cacheStats();
    assert.equal(typeof cacheStats.dependencyHitRate, 'number');
    assert.equal(typeof cacheStats.buildHitRate, 'number');

    await runtime.stop(ws.id);
    assert.equal((await runtime.health(ws.id)), 'stopped');
  } finally {
    if (ws) {
      await runtime.stop(ws.id).catch(() => {});
    }
    await fs.rm(base, { recursive: true, force: true });
    await fs.rm(repo, { recursive: true, force: true });
  }
});

test('runtime failure transitions workspace to failed state', async () => {
  const repo = await mkFailingRepo();
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'gitpis-ws-fail-'));
  const runtime = createWasmWorkspace({ workspaceBase: base });

  let ws;

  try {
    ws = await runtime.launch(repo);

    for (let i = 0; i < MAX_HEALTH_CHECK_ATTEMPTS; i += 1) {
      if ((await runtime.health(ws.id)) === 'failed') {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    assert.equal(await runtime.health(ws.id), 'failed');
    const events = await runtime.events(ws.id);
    assert.ok(events.some((event) => event.type === 'WorkspaceFailed'));
  } finally {
    if (ws) {
      await runtime.stop(ws.id).catch(() => {});
    }
    await fs.rm(base, { recursive: true, force: true });
    await fs.rm(repo, { recursive: true, force: true });
  }
});

test('workspace snapshot, suspend, and restore preserve filesystem state', async () => {
  const repo = await mkRunningRepo();
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'gitpis-ws-snapshot-'));
  const runtime = createWasmWorkspace({ workspaceBase: base });

  let ws;
  try {
    ws = await runtime.launch(repo);
    const filesystem = await runtime.filesystem(ws.id);
    await filesystem.writeFile('state.txt', 'alpha');

    const firstSnapshot = await runtime.snapshot(ws.id);
    await filesystem.writeFile('state.txt', 'beta');
    const secondSnapshot = await runtime.snapshot(ws.id);
    assert.notEqual(firstSnapshot.id, secondSnapshot.id);

    const snapshots = await runtime.listSnapshots(ws.id);
    assert.ok(snapshots.length >= 2);

    await runtime.suspend(ws.id);
    assert.equal(await runtime.health(ws.id), 'suspended');

    await runtime.resume(ws.id);
    assert.equal(await runtime.health(ws.id), 'running');
    const resumedFs = await runtime.filesystem(ws.id);
    assert.equal(await resumedFs.readFile('state.txt', 'utf8'), 'beta');

    await runtime.restore(ws.id, firstSnapshot.id);
    assert.equal(await runtime.health(ws.id), 'running');
    const restoredFs = await runtime.filesystem(ws.id);
    assert.equal(await restoredFs.readFile('state.txt', 'utf8'), 'alpha');
  } finally {
    if (ws) {
      await runtime.stop(ws.id).catch(() => {});
    }
    await fs.rm(base, { recursive: true, force: true });
    await fs.rm(repo, { recursive: true, force: true });
  }
});
