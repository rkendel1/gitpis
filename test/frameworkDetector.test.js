import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import { detectFramework, generateExecutionPlan } from '../src/frameworkDetector.js';

async function mkTempRepo(structure) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gitpis-fw-'));
  for (const [name, content] of Object.entries(structure)) {
    const file = path.join(dir, name);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, content);
  }
  return dir;
}

test('detects nextjs via next.config.js', async () => {
  const repo = await mkTempRepo({ 'next.config.js': 'module.exports = {};' });
  try {
    const framework = await detectFramework(repo);
    assert.equal(framework, 'nextjs');
  } finally {
    await fs.rm(repo, { recursive: true, force: true });
  }
});

test('falls back to static when no known files exist', async () => {
  const repo = await mkTempRepo({ 'README.md': '# example' });
  try {
    const framework = await detectFramework(repo);
    assert.equal(framework, 'static');
  } finally {
    await fs.rm(repo, { recursive: true, force: true });
  }
});

test('execution plan includes default port', () => {
  const plan = generateExecutionPlan('vite');
  assert.equal(plan.defaultPort, 5173);
  assert.match(plan.start, /npm run dev/);
});

test('detects express via package.json dependency', async () => {
  const repo = await mkTempRepo({
    'package.json': JSON.stringify({
      name: 'express-app',
      dependencies: {
        express: '^5.0.0'
      }
    })
  });

  try {
    const framework = await detectFramework(repo);
    assert.equal(framework, 'express');
  } finally {
    await fs.rm(repo, { recursive: true, force: true });
  }
});

test('nextjs execution plan launches dev server', () => {
  const plan = generateExecutionPlan('nextjs');
  assert.equal(plan.defaultPort, 3000);
  assert.equal(plan.start, 'npm run dev');
});
