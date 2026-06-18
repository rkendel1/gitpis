import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';

function runCommand(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(stderr.trim() || `Command failed: ${command} ${args.join(' ')}`));
      }
    });
  });
}

async function copyRecursive(from, to) {
  await fs.mkdir(to, { recursive: true });
  const entries = await fs.readdir(from, { withFileTypes: true });

  for (const entry of entries) {
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);
    if (entry.isDirectory()) {
      await copyRecursive(src, dst);
    } else {
      await fs.copyFile(src, dst);
    }
  }
}

export async function cloneRepository(repoUrl, destination) {
  await fs.rm(destination, { recursive: true, force: true });
  await fs.mkdir(path.dirname(destination), { recursive: true });

  if (repoUrl.startsWith('-')) {
    throw new Error('Invalid repository URL');
  }

  if (repoUrl.startsWith('file://')) {
    await copyRecursive(repoUrl.replace('file://', ''), destination);
    return destination;
  }

  if (path.isAbsolute(repoUrl)) {
    await copyRecursive(repoUrl, destination);
    return destination;
  }

  await runCommand('git', ['clone', '--depth', '1', '--', repoUrl, destination], process.cwd());
  return destination;
}

export async function analyzeRepository(repoPath) {
  const entries = await fs.readdir(repoPath, { withFileTypes: true });
  const topLevelFiles = entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
  const topLevelDirs = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);

  return {
    path: repoPath,
    topLevelFiles,
    topLevelDirs,
    hasGit: topLevelDirs.includes('.git')
  };
}
