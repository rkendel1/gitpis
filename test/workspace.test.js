import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import { createWasmWorkspace } from '../src/index.js';

async function mkRepo() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gitpis-repo-'));
  await fs.writeFile(path.join(dir, 'package.json'), JSON.stringify({ name: 'demo' }));
  await fs.mkdir(path.join(dir, 'src'));
  await fs.writeFile(path.join(dir, 'src', 'index.js'), 'console.log("ok")');
  return dir;
}

test('launch/stop/restart lifecycle works', async () => {
  const repo = await mkRepo();
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'gitpis-ws-'));
  const runtime = createWasmWorkspace({ workspaceBase: base });

  try {
    const ws = await runtime.launch(repo);
    assert.equal(ws.framework, 'node');
    assert.equal(ws.status, 'running');

    const ports = await runtime.ports(ws.id);
    assert.equal(ports[0].port, 3000);

    await runtime.stop(ws.id);
    assert.equal((await runtime.health(ws.id)), 'stopped');

    await runtime.restart(ws.id);
    assert.equal((await runtime.health(ws.id)), 'healthy');

    const filesystem = runtime.filesystem(ws.id);
    const files = await filesystem.list('.');
    assert.ok(files.includes('package.json'));
  } finally {
    await fs.rm(base, { recursive: true, force: true });
    await fs.rm(repo, { recursive: true, force: true });
  }
});
