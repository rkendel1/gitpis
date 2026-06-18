import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import { createWasmWorkspace } from '../src/index.js';
import { createRestServer } from '../src/restServer.js';

async function mkRecoverableRepo() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gitpis-recovery-repo-'));
  await fs.writeFile(path.join(dir, 'package.json'), JSON.stringify({
    name: 'recovery-demo',
    scripts: {
      build: 'node build.js'
    }
  }));
  await fs.writeFile(path.join(dir, 'build.js'), 'console.log("build complete")');
  await fs.writeFile(path.join(dir, 'start.js'), 'console.log("ready on 3000"); setInterval(() => {}, 1000);');
  return dir;
}

test('workspace launch auto-recovers missing script and tracks repair history', async () => {
  const repo = await mkRecoverableRepo();
  const workspaceBase = await fs.mkdtemp(path.join(os.tmpdir(), 'gitpis-recovery-ws-'));
  const workspace = createWasmWorkspace({ workspaceBase });
  let ws;

  try {
    ws = await workspace.launch(repo);
    assert.equal(ws.status, 'running');

    const pkg = JSON.parse(await fs.readFile(path.join(ws.repoPath, 'package.json'), 'utf8'));
    assert.equal(pkg.scripts.start, 'node start.js');

    const repairs = workspace.repairs(ws.id);
    assert.ok(repairs.length >= 1);
    assert.equal(repairs[0].diagnosis.category, 'MissingScript');
    assert.equal(repairs[0].result.success, true);

    const diagnostics = workspace.diagnostics();
    assert.ok(diagnostics.some((item) => item.workspaceId === ws.id));

    const health = await workspace.workspaceHealthScore(ws.id);
    assert.equal(typeof health.score, 'number');
    assert.ok(health.score >= 0 && health.score <= 100);
  } finally {
    if (ws) {
      await workspace.stop(ws.id).catch(() => {});
    }
    await fs.rm(workspaceBase, { recursive: true, force: true });
    await fs.rm(repo, { recursive: true, force: true });
  }
});

test('REST server exposes repair and diagnostics APIs', async () => {
  const repo = await mkRecoverableRepo();
  const workspaceBase = await fs.mkdtemp(path.join(os.tmpdir(), 'gitpis-recovery-api-ws-'));
  const workspace = createWasmWorkspace({ workspaceBase });
  const server = createRestServer({ workspace });
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  let workspaceId;
  try {
    const launchRes = await fetch(`${baseUrl}/workspaces`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ repoUrl: repo })
    });
    assert.equal(launchRes.status, 201);
    const launched = await launchRes.json();
    workspaceId = launched.id;

    const repairsRes = await fetch(`${baseUrl}/repairs`);
    assert.equal(repairsRes.status, 200);
    const repairs = await repairsRes.json();
    assert.ok(repairs.some((item) => item.workspaceId === workspaceId));

    const workspaceRepairsRes = await fetch(`${baseUrl}/repairs/${workspaceId}`);
    assert.equal(workspaceRepairsRes.status, 200);
    const workspaceRepairs = await workspaceRepairsRes.json();
    assert.ok(workspaceRepairs.length >= 1);

    const diagnosticsRes = await fetch(`${baseUrl}/diagnostics`);
    assert.equal(diagnosticsRes.status, 200);
    const diagnostics = await diagnosticsRes.json();
    assert.ok(diagnostics.some((item) => item.workspaceId === workspaceId));

    const healthRes = await fetch(`${baseUrl}/workspace/${workspaceId}/health`);
    assert.equal(healthRes.status, 200);
    const health = await healthRes.json();
    assert.equal(health.workspaceId, workspaceId);
    assert.equal(typeof health.score, 'number');
  } finally {
    server.close();
    if (workspaceId) {
      await workspace.stop(workspaceId).catch(() => {});
    }
    await fs.rm(workspaceBase, { recursive: true, force: true });
    await fs.rm(repo, { recursive: true, force: true });
  }
});
