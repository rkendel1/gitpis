import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import { PackageManager, detectPackageManager, NodeRuntimeProvider, evaluateNodeRuntimeCandidates } from '../src/providers.js';

async function mkRepo(files) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gitpis-provider-'));
  for (const [fileName, content] of Object.entries(files)) {
    const fullPath = path.join(dir, fileName);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, content);
  }
  return dir;
}

test('detectPackageManager honors lockfile precedence', async () => {
  const repo = await mkRepo({
    'package.json': JSON.stringify({ name: 'pm-test' }),
    'pnpm-lock.yaml': 'lockfileVersion: 9'
  });

  try {
    const manager = await detectPackageManager(repo, ['package.json', 'pnpm-lock.yaml']);
    assert.equal(manager, PackageManager.Pnpm);
  } finally {
    await fs.rm(repo, { recursive: true, force: true });
  }
});

test('NodeRuntimeProvider builds lockfile-aware commands', async () => {
  const repo = await mkRepo({
    'package.json': JSON.stringify({
      name: 'vite-app',
      scripts: {
        dev: 'vite',
        build: 'vite build'
      }
    }),
    'yarn.lock': '# lock'
  });

  try {
    const provider = new NodeRuntimeProvider();
    const artifact = await provider.build({
      workspaceId: 'ws-1',
      framework: 'vite',
      path: repo,
      topLevelFiles: ['package.json', 'yarn.lock'],
      executionPlan: { defaultPort: 5173 }
    });

    assert.equal(artifact.runtime, 'node-wasm');
    assert.equal(artifact.packageManager, PackageManager.Yarn);
    assert.equal(artifact.installCommand, 'yarn install --frozen-lockfile');
    assert.equal(artifact.buildCommand, 'yarn run build');
    assert.match(artifact.startCommand, /yarn run dev/);
  } finally {
    await fs.rm(repo, { recursive: true, force: true });
  }
});

test('runtime candidate evaluation returns recommendation and benchmarks', () => {
  const result = evaluateNodeRuntimeCandidates();
  assert.ok(Array.isArray(result.candidates));
  assert.ok(result.candidates.length >= 5);
  assert.equal(result.recommendation.primary, 'Node WASI');
  assert.equal(typeof result.recommendation.benchmarkData.coldStartSeconds, 'number');
});
