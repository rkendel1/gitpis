import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { createWasmWorkspace } from '../src/index.js';
import { createRestServer } from '../src/restServer.js';

const execFileAsync = promisify(execFile);

async function runGit(cwd, args) {
  await execFileAsync('git', args, { cwd });
}

async function mkRepoWithGit() {
  const repo = await fs.mkdtemp(path.join(os.tmpdir(), 'gitpis-ide-repo-'));
  const pkg = {
    name: 'ide-demo',
    scripts: {
      build: 'node build.js',
      start: 'node start.js'
    }
  };
  await fs.writeFile(path.join(repo, 'package.json'), JSON.stringify(pkg));
  await fs.writeFile(path.join(repo, 'build.js'), 'console.log("build done")');
  await fs.writeFile(path.join(repo, 'start.js'), 'console.log("ready: http://localhost:5173"); setInterval(() => {}, 1000);');
  await fs.mkdir(path.join(repo, 'src'), { recursive: true });
  await fs.writeFile(path.join(repo, 'src', 'index.js'), 'export const value = 1;\n');

  await runGit(repo, ['init']);
  await runGit(repo, ['config', 'user.email', 'bot@example.com']);
  await runGit(repo, ['config', 'user.name', 'gitpis-bot']);
  await runGit(repo, ['add', '.']);
  await runGit(repo, ['commit', '-m', 'init']);

  return repo;
}

test('REST server exposes PR8 file, terminal, and git APIs', async () => {
  const repo = await mkRepoWithGit();
  const workspaceBase = await fs.mkdtemp(path.join(os.tmpdir(), 'gitpis-ide-ws-'));
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

    const filesRes = await fetch(`${baseUrl}/workspaces/${workspaceId}/files?path=.`);
    assert.equal(filesRes.status, 200);
    const files = await filesRes.json();
    assert.ok(files.includes('package.json'));

    const writeRes = await fetch(`${baseUrl}/workspaces/${workspaceId}/file`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: 'src/App.tsx', content: 'export default function App(){return "ok";}\n' })
    });
    assert.equal(writeRes.status, 200);

    const readRes = await fetch(`${baseUrl}/workspaces/${workspaceId}/file?path=src/App.tsx`);
    assert.equal(readRes.status, 200);
    const filePayload = await readRes.json();
    assert.match(filePayload.content, /return "ok"/);

    const terminalRes = await fetch(`${baseUrl}/workspaces/${workspaceId}/terminal`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ command: 'node', args: ['-e', 'console.log("term-ok")'] })
    });
    assert.equal(terminalRes.status, 200);
    const terminalPayload = await terminalRes.json();
    assert.equal(terminalPayload.ok, true);
    assert.match(terminalPayload.stdout, /term-ok/);

    const statusRes = await fetch(`${baseUrl}/workspaces/${workspaceId}/git/status`);
    assert.equal(statusRes.status, 200);
    const statusPayload = await statusRes.json();
    assert.equal(typeof statusPayload.ok, 'boolean');
    assert.match(statusPayload.stdout, /##/);

    const commitRes = await fetch(`${baseUrl}/workspaces/${workspaceId}/git/commit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'feat: pr8 api smoke', stageAll: true })
    });
    assert.equal(commitRes.status, 200);
    const commitPayload = await commitRes.json();
    assert.equal(commitPayload.ok, true);

    const pushRes = await fetch(`${baseUrl}/workspaces/${workspaceId}/git/push`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ remote: 'origin', branch: 'main' })
    });
    assert.equal(pushRes.status, 200);
    const pushPayload = await pushRes.json();
    assert.equal(typeof pushPayload.ok, 'boolean');
  } finally {
    server.close();
    if (workspaceId) {
      await workspace.stop(workspaceId).catch(() => {});
    }
    await fs.rm(workspaceBase, { recursive: true, force: true });
    await fs.rm(repo, { recursive: true, force: true });
  }
});
