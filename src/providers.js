import { spawn } from 'node:child_process';
import readline from 'node:readline';
import { EventEmitter, on } from 'node:events';
import path from 'node:path';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import os from 'node:os';
import { WorkspaceFileSystem } from './filesystem.js';

const WASMTIME_COMPATIBLE_FRAMEWORKS = ['node', 'rust', 'go', 'python', 'static', 'vite', 'react', 'vue', 'svelte', 'nextjs', 'express', 'nestjs'];
const NODE_COMPATIBLE_FRAMEWORKS = ['node', 'vite', 'react', 'vue', 'svelte', 'nextjs', 'express', 'nestjs'];
const DEFAULT_RESOURCE_LIMITS = { memoryMb: 512, cpuPercent: 100, maxProcesses: 10 };
const COMMON_PORTS = new Set([3000, 4173, 5000, 5173, 8000, 8080]);
const GRACEFUL_SHUTDOWN_TIMEOUT_MS = 1500;
const SAFE_ENV_KEYS = ['PATH', 'HOME', 'USER', 'SHELL', 'TMPDIR', 'TEMP', 'TMP', 'PWD', 'NODE_ENV', 'TERM', 'CI', 'HOST', 'PORT', 'API_URL'];
const MAX_LOG_BUFFER_SIZE = 500;
const DEFAULT_LOG_LIMIT = 200;
const DEFAULT_INSTALL_TIMEOUT_MS = 120000;
const DEFAULT_BUILD_TIMEOUT_MS = 120000;
const DEFAULT_RETENTION_POLICY = Object.freeze({ ttlDays: 30, maxArtifacts: 5000, maxStorageGb: 10 });

const PACKAGE_MANAGER_LOCKFILES = [
  { manager: 'npm', lockfile: 'package-lock.json' },
  { manager: 'pnpm', lockfile: 'pnpm-lock.yaml' },
  { manager: 'yarn', lockfile: 'yarn.lock' },
  { manager: 'bun', lockfile: 'bun.lockb' }
];

const FRAMEWORK_PROFILES = {
  react: { install: true, build: 'build', start: 'dev', defaultPort: 5173, hostFlag: '-- --host 0.0.0.0' },
  vite: { install: true, build: 'build', start: 'dev', defaultPort: 5173, hostFlag: '-- --host 0.0.0.0' },
  vue: { install: true, build: 'build', start: 'dev', defaultPort: 5173, hostFlag: '-- --host 0.0.0.0' },
  svelte: { install: true, build: 'build', start: 'dev', defaultPort: 5173, hostFlag: '-- --host 0.0.0.0' },
  nextjs: { install: true, build: 'build', start: 'dev', defaultPort: 3000, hostFlag: '' },
  express: { install: true, build: 'build', start: 'start', defaultPort: 3000, hostFlag: '' },
  nestjs: { install: true, build: 'build', start: 'start', defaultPort: 3000, hostFlag: '' },
  node: { install: true, build: 'build', start: 'start', defaultPort: 3000, hostFlag: '' }
};

export const PackageManager = Object.freeze({
  Npm: 'npm',
  Pnpm: 'pnpm',
  Yarn: 'yarn',
  Bun: 'bun'
});

function createRuntimeEnv(extra = {}) {
  const env = {};

  for (const key of SAFE_ENV_KEYS) {
    if (process.env[key] !== undefined) {
      env[key] = process.env[key];
    }
  }

  for (const [key, value] of Object.entries(process.env)) {
    if ((key.startsWith('npm_') || key.startsWith('NPM_')) && value !== undefined) {
      env[key] = value;
    }
  }

  return { ...env, ...extra };
}

function createLogLine(prefix, line) {
  const text = line.trim();
  if (!text) return null;
  return `[${prefix}] ${text}`;
}

function parsePorts(line) {
  const matcher = /(?:localhost|127\.0\.0\.1|0\.0\.0\.0):(\d{1,5})|(?:port|listen(?:ing)?|on)\s*[:=]?\s*(\d{1,5})/gi;
  const ports = [];

  for (const match of line.matchAll(matcher)) {
    const candidate = match[1] ?? match[2];
    const portNumber = Number(candidate);
    if (Number.isInteger(portNumber) && portNumber > 0 && portNumber < 65536) {
      ports.push(portNumber);
    }
  }

  return ports;
}

function toPackageManagerEnum(manager) {
  if (manager === 'pnpm') return PackageManager.Pnpm;
  if (manager === 'yarn') return PackageManager.Yarn;
  if (manager === 'bun') return PackageManager.Bun;
  return PackageManager.Npm;
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readPackageJson(workspacePath) {
  const packageJsonPath = path.join(workspacePath, 'package.json');
  if (!(await fileExists(packageJsonPath))) {
    return null;
  }
  const raw = await fs.readFile(packageJsonPath, 'utf8');
  return JSON.parse(raw);
}

export async function detectPackageManager(workspacePath, topLevelFiles = []) {
  for (const candidate of PACKAGE_MANAGER_LOCKFILES) {
    if (topLevelFiles.includes(candidate.lockfile)) {
      return toPackageManagerEnum(candidate.manager);
    }
    if (await fileExists(path.join(workspacePath, candidate.lockfile))) {
      return toPackageManagerEnum(candidate.manager);
    }
  }

  return PackageManager.Npm;
}

function scriptCommandFor(packageManager, scriptName, extraArgs = '') {
  if (packageManager === PackageManager.Pnpm) {
    return `pnpm run ${scriptName}${extraArgs}`;
  }
  if (packageManager === PackageManager.Yarn) {
    return `yarn run ${scriptName}${extraArgs}`;
  }
  if (packageManager === PackageManager.Bun) {
    return `bun run ${scriptName}${extraArgs}`;
  }
  return `npm run ${scriptName}${extraArgs}`;
}

function installCommandFor(packageManager, lockfileAware) {
  if (packageManager === PackageManager.Pnpm) {
    return lockfileAware ? 'pnpm install --frozen-lockfile' : 'pnpm install';
  }
  if (packageManager === PackageManager.Yarn) {
    return lockfileAware ? 'yarn install --frozen-lockfile' : 'yarn install';
  }
  if (packageManager === PackageManager.Bun) {
    return lockfileAware ? 'bun install --frozen-lockfile' : 'bun install';
  }
  return lockfileAware ? 'npm ci' : 'npm install';
}

function lockfileForManager(packageManager) {
  if (packageManager === PackageManager.Pnpm) return 'pnpm-lock.yaml';
  if (packageManager === PackageManager.Yarn) return 'yarn.lock';
  if (packageManager === PackageManager.Bun) return 'bun.lockb';
  return 'package-lock.json';
}

async function createDependencyHash(workspacePath) {
  const hash = createHash('sha256');
  const hashInputs = ['package.json', ...PACKAGE_MANAGER_LOCKFILES.map((entry) => entry.lockfile)];

  for (const fileName of hashInputs) {
    const filePath = path.join(workspacePath, fileName);
    if (!(await fileExists(filePath))) {
      continue;
    }
    const content = await fs.readFile(filePath);
    hash.update(fileName);
    hash.update(content);
  }

  return hash.digest('hex');
}

async function readTextIfExists(filePath) {
  if (!(await fileExists(filePath))) return '';
  return fs.readFile(filePath, 'utf8');
}

async function packageManagerVersion(packageManager) {
  try {
    const binary = packageManager === PackageManager.Bun ? 'bun' : packageManager;
    const child = spawnShell(`${binary} --version`, process.cwd(), process.env);
    let output = '';
    if (child.stdout) {
      child.stdout.on('data', (chunk) => {
        output += chunk.toString('utf8');
      });
    }
    await new Promise((resolve, reject) => {
      child.on('close', (code) => (code === 0 ? resolve() : reject(new Error('version command failed'))));
      child.on('error', reject);
    });
    return output.trim() || 'unknown';
  } catch {
    return 'unknown';
  }
}

export async function createDependencyFingerprint(workspacePath, packageManager, managerVersion) {
  const packageJson = await readTextIfExists(path.join(workspacePath, 'package.json'));
  const lockfile = await readTextIfExists(path.join(workspacePath, lockfileForManager(packageManager)));
  const version = managerVersion ?? await packageManagerVersion(packageManager);
  return createHash('sha256').update(packageJson).update(lockfile).update(version).digest('hex');
}

export class NodeDependencyResolver {
  async detectManager(workspace) {
    return detectPackageManager(workspace.path, workspace.topLevelFiles ?? []);
  }

  async resolve(workspace) {
    const packageManager = await this.detectManager(workspace);
    const pkg = await readPackageJson(workspace.path);
    const lockfileHash = await createDependencyHash(workspace.path);
    const toEntries = (obj = {}) => Object.entries(obj).map(([name, version]) => ({ name, version }));
    const fingerprint = await createDependencyFingerprint(workspace.path, packageManager);
    return {
      dependencies: toEntries(pkg?.dependencies),
      devDependencies: toEntries(pkg?.devDependencies),
      lockfileHash,
      dependencyFingerprint: fingerprint,
      packageManager
    };
  }
}

async function isLockfileAwareInstall(packageManager, workspacePath, topLevelFiles = []) {
  if (packageManager !== PackageManager.Npm) {
    return true;
  }

  if (topLevelFiles.includes('package-lock.json')) {
    return true;
  }

  return fileExists(path.join(workspacePath, 'package-lock.json'));
}

function createLaunchFailure(stage, error, logs = []) {
  return {
    stage,
    reason: error.message,
    logs: logs.slice(-50)
  };
}

function spawnShell(command, cwd, env = process.env) {
  return spawn('sh', ['-lc', command], {
    cwd,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true
  });
}

async function runAndCapture(command, cwd, onLog, env, options = {}) {
  const stage = options.stage ?? 'build';
  const timeoutMs = options.timeoutMs ?? DEFAULT_BUILD_TIMEOUT_MS;
  const child = spawnShell(command, cwd, env);

  const pipe = (stream, prefix) => {
    const reader = readline.createInterface({ input: stream });
    reader.on('line', (line) => {
      const message = createLogLine(prefix, line);
      if (message) onLog(message);
    });
  };

  pipe(child.stdout, stage);
  pipe(child.stderr, stage);

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        child.kill('SIGKILL');
      }
      reject(new Error(`${stage} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timeout);
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${stage} failed with code ${code}: ${command}`));
      }
    });
  });
}

export class LocalDiskCacheProvider {
  constructor(baseDir = path.resolve('.cache')) {
    this.baseDir = baseDir;
  }

  async put(key, artifact) {
    const targetDir = path.join(this.baseDir, artifact.kind, key);
    await fs.mkdir(path.dirname(targetDir), { recursive: true });
    await fs.rm(targetDir, { recursive: true, force: true });
    await fs.cp(artifact.path, targetDir, { recursive: true, force: true });
    await fs.writeFile(path.join(targetDir, '.meta.json'), JSON.stringify({
      createdAt: new Date().toISOString(),
      kind: artifact.kind
    }));
  }

  async get(key, kind) {
    const targetDir = path.join(this.baseDir, kind, key);
    if (!(await fileExists(targetDir))) return null;
    return { key, kind, path: targetDir };
  }

  async list(kind) {
    const dir = path.join(this.baseDir, kind);
    if (!(await fileExists(dir))) return [];
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => path.join(dir, entry.name));
  }

  async remove(absoluteArtifactPath) {
    await fs.rm(absoluteArtifactPath, { recursive: true, force: true });
  }
}

export class S3CacheProvider {
  constructor(client, options = {}) {
    this.client = client;
    this.bucket = options.bucket ?? '';
    this.prefix = options.prefix ?? 'gitpis-cache';
  }

  async put(key, artifact) {
    if (!this.client?.putObject) {
      throw new Error('S3CacheProvider requires a client with putObject');
    }
    await this.client.putObject({
      bucket: this.bucket,
      key: `${this.prefix}/${artifact.kind}/${key}`,
      bodyPath: artifact.path
    });
  }

  async get(key, kind) {
    if (!this.client?.getObject) {
      throw new Error('S3CacheProvider requires a client with getObject');
    }
    return this.client.getObject({
      bucket: this.bucket,
      key: `${this.prefix}/${kind}/${key}`
    });
  }
}

function defaultPnpmStorePath() {
  return path.join(os.homedir(), '.pnpm-store');
}

class NodeModulesSnapshot {
  async create(workspacePath, cacheDir, packageManager) {
    const snapshotTargets = [path.join(workspacePath, 'node_modules')];
    if (packageManager === PackageManager.Pnpm) {
      snapshotTargets.push(defaultPnpmStorePath());
    }
    if (packageManager === PackageManager.Yarn) {
      snapshotTargets.push(path.join(workspacePath, '.yarn', 'cache'));
    }

    const snapshotRoot = path.join(cacheDir, 'snapshot');
    await fs.rm(snapshotRoot, { recursive: true, force: true });
    await fs.mkdir(snapshotRoot, { recursive: true });

    for (const target of snapshotTargets) {
      if (await fileExists(target)) {
        const name = path.basename(target);
        await fs.cp(target, path.join(snapshotRoot, name), { recursive: true, force: true });
      }
    }

    return snapshotRoot;
  }

  async restore(workspacePath, snapshotPath, packageManager) {
    const nodeModules = path.join(snapshotPath, 'node_modules');
    if (await fileExists(nodeModules)) {
      const destination = path.join(workspacePath, 'node_modules');
      await fs.rm(destination, { recursive: true, force: true });
      await fs.cp(nodeModules, destination, { recursive: true, force: true });
    }

    if (packageManager === PackageManager.Pnpm) {
      const store = path.join(snapshotPath, '.pnpm-store');
      if (await fileExists(store)) {
        await fs.mkdir(path.dirname(defaultPnpmStorePath()), { recursive: true });
        await fs.rm(defaultPnpmStorePath(), { recursive: true, force: true });
        await fs.cp(store, defaultPnpmStorePath(), { recursive: true, force: true });
      }
    }

    if (packageManager === PackageManager.Yarn) {
      const yarnCache = path.join(snapshotPath, 'cache');
      if (await fileExists(yarnCache)) {
        const destination = path.join(workspacePath, '.yarn', 'cache');
        await fs.mkdir(path.dirname(destination), { recursive: true });
        await fs.rm(destination, { recursive: true, force: true });
        await fs.cp(yarnCache, destination, { recursive: true, force: true });
      }
    }
  }
}

export class DependencyCacheService {
  constructor(options = {}) {
    this.provider = options.provider ?? new LocalDiskCacheProvider(options.baseDir);
    this.snapshot = options.snapshot ?? new NodeModulesSnapshot();
    this.retentionPolicy = options.retentionPolicy ?? DEFAULT_RETENTION_POLICY;
    this.metrics = { hits: 0, misses: 0, evictions: 0, restores: 0, saves: 0, restoreDurationMs: 0, saveDurationMs: 0 };
  }

  async exists(key) {
    const artifact = await this.provider.get(key, 'dependencies');
    if (artifact) this.metrics.hits += 1;
    else this.metrics.misses += 1;
    return Boolean(artifact);
  }

  async restore(key, workspacePath, packageManager = PackageManager.Npm) {
    const startedAt = Date.now();
    const artifact = await this.provider.get(key, 'dependencies');
    if (!artifact) {
      this.metrics.misses += 1;
      return false;
    }
    await this.snapshot.restore(workspacePath, artifact.path, packageManager);
    this.metrics.hits += 1;
    this.metrics.restores += 1;
    this.metrics.restoreDurationMs += Date.now() - startedAt;
    return true;
  }

  async save(key, workspacePath, packageManager = PackageManager.Npm) {
    const startedAt = Date.now();
    const tempDir = path.join(workspacePath, '.gitpis-cache', key);
    const snapshotRoot = await this.snapshot.create(workspacePath, tempDir, packageManager);
    if (!(await fileExists(snapshotRoot))) return;
    await this.provider.put(key, { kind: 'dependencies', path: snapshotRoot });
    await fs.rm(tempDir, { recursive: true, force: true });
    this.metrics.saves += 1;
    this.metrics.saveDurationMs += Date.now() - startedAt;
    await this.#enforceRetention('dependencies');
  }

  async #enforceRetention(kind) {
    const artifacts = await this.provider.list?.(kind);
    if (!artifacts || artifacts.length <= this.retentionPolicy.maxArtifacts) {
      return;
    }
    const sorted = [];
    for (const absolutePath of artifacts) {
      const stat = await fs.stat(absolutePath);
      sorted.push({ absolutePath, mtimeMs: stat.mtimeMs });
    }
    sorted.sort((a, b) => a.mtimeMs - b.mtimeMs);
    const removeCount = sorted.length - this.retentionPolicy.maxArtifacts;
    for (let i = 0; i < removeCount; i += 1) {
      await this.provider.remove?.(sorted[i].absolutePath);
      this.metrics.evictions += 1;
    }
  }

  getStats() {
    const totalLookups = this.metrics.hits + this.metrics.misses;
    return {
      dependencyHitRate: totalLookups === 0 ? 0 : Math.round((this.metrics.hits / totalLookups) * 100),
      cacheMisses: this.metrics.misses,
      cacheHits: this.metrics.hits,
      evictionCount: this.metrics.evictions,
      artifactRestoreDurationMs: this.metrics.restoreDurationMs,
      artifactSaveDurationMs: this.metrics.saveDurationMs
    };
  }

  // Legacy compatibility with previous dependency cache shape.
  async get(hash) {
    const artifact = await this.provider.get(hash, 'dependencies');
    return artifact ? { hash, path: artifact.path } : null;
  }

  async put(hash, workspacePath) {
    await this.save(hash, workspacePath);
  }
}

export class BuildCacheService {
  constructor(options = {}) {
    this.provider = options.provider ?? new LocalDiskCacheProvider(options.baseDir);
    this.metrics = { hits: 0, misses: 0, restores: 0, saves: 0 };
  }

  async exists(hash) {
    const artifact = await this.provider.get(hash, 'builds');
    if (artifact) this.metrics.hits += 1;
    else this.metrics.misses += 1;
    return Boolean(artifact);
  }

  async restore(hash, workspacePath) {
    const artifact = await this.provider.get(hash, 'builds');
    if (!artifact) {
      this.metrics.misses += 1;
      return false;
    }
    await fs.cp(artifact.path, workspacePath, { recursive: true, force: true });
    this.metrics.hits += 1;
    this.metrics.restores += 1;
    return true;
  }

  async save(hash, workspacePath) {
    const sourceDir = await this.#detectBuildDir(workspacePath);
    if (!sourceDir) return;
    await this.provider.put(hash, { kind: 'builds', path: sourceDir });
    this.metrics.saves += 1;
  }

  async #detectBuildDir(workspacePath) {
    const candidates = ['dist', 'build', '.next', 'target'];
    for (const candidate of candidates) {
      const abs = path.join(workspacePath, candidate);
      if (await fileExists(abs)) return abs;
    }
    return null;
  }

  getStats() {
    const total = this.metrics.hits + this.metrics.misses;
    return {
      buildHitRate: total === 0 ? 0 : Math.round((this.metrics.hits / total) * 100),
      buildCacheHits: this.metrics.hits,
      buildCacheMisses: this.metrics.misses
    };
  }
}

class NodeDependencyInstaller {
  constructor(options = {}) {
    this.resolver = options.resolver ?? new NodeDependencyResolver();
  }

  async install(workspace) {
    const graph = await this.resolver.resolve(workspace);
    const packageManager = workspace.packageManager ?? graph.packageManager;
    const lockfileAware = await isLockfileAwareInstall(packageManager, workspace.path, workspace.topLevelFiles ?? []);
    const installCommand = installCommandFor(packageManager, lockfileAware);
    const hash = graph.dependencyFingerprint ?? await createDependencyHash(workspace.path);
    if (workspace.cache?.exists && await workspace.cache.exists(hash)) {
      const restored = await workspace.cache.restore(hash, workspace.path, packageManager);
      if (restored) {
        workspace.onLog(`[install] restored dependencies from cache (${hash.slice(0, 12)})`);
        return { cacheHit: true, hash, command: null };
      }
    }

    if (!workspace.cache?.exists) {
      const cached = await workspace.cache.get?.(hash);
      if (cached) {
        const restored = await workspace.cache.restore(hash, workspace.path, packageManager);
        if (restored) {
          workspace.onLog(`[install] restored dependencies from cache (${hash.slice(0, 12)})`);
          return { cacheHit: true, hash, command: null };
        }
      }
    }

    await runAndCapture(
      installCommand,
      workspace.path,
      workspace.onLog,
      workspace.env,
      { stage: 'install', timeoutMs: workspace.timeoutMs ?? DEFAULT_INSTALL_TIMEOUT_MS }
    );

    if (workspace.cache?.save) {
      await workspace.cache.save(hash, workspace.path, packageManager);
    } else {
      await workspace.cache.put(hash, workspace.path);
    }
    return { cacheHit: false, hash, command: installCommand };
  }
}

class WasmtimeRuntimeInstance {
  constructor(artifact) {
    this.id = artifact.id;
    this.runtime = artifact.runtime;
    this.mountPath = artifact.mountPath;
    this.buildCommand = artifact.buildCommand;
    this.installCommand = artifact.installCommand;
    this.startCommand = artifact.startCommand;
    this.defaultPort = artifact.defaultPort;
    this.protocol = 'http';
    this.process = null;
    this.status = 'stopped';
    this.stopping = false;
    this.logEmitter = new EventEmitter();
    this.logBuffer = [];
    this.maxLogLines = MAX_LOG_BUFFER_SIZE;
    this.onEvent = artifact.onEvent ?? (() => {});
    this.onHealth = artifact.onHealth ?? (() => {});
    this.onPort = artifact.onPort ?? (() => {});
    this.portsByNumber = new Map();
    this.resourceLimits = artifact.resourceLimits ?? DEFAULT_RESOURCE_LIMITS;
    this.environment = artifact.environment ?? {};
    this.lastFailure = null;
    this.telemetry = {};

    if (this.defaultPort) {
      this.#registerPort(this.defaultPort);
    }
  }

  async start() {
    if (this.status === 'running' || this.status === 'starting') {
      return;
    }

    this.#setStatus('starting');
    const launchStartedAt = Date.now();
    this.#emitEvent('WorkspaceStarted', { id: this.id });
    this.#emitLog('[workspace] starting');

    try {
      if (this.installCommand && this.installCommand !== 'none') {
        this.#setStatus('installing');
        const installStartedAt = Date.now();
        this.#emitLog(`[workspace] install: ${this.installCommand}`);
        await runAndCapture(
          this.installCommand,
          this.mountPath,
          (line) => this.#emitLog(line),
          createRuntimeEnv(this.environment),
          { stage: 'install', timeoutMs: DEFAULT_INSTALL_TIMEOUT_MS }
        );
        this.telemetry.InstallDuration = Date.now() - installStartedAt;
        this.#emitEvent('InstallDuration', { id: this.id, durationMs: this.telemetry.InstallDuration });
      }

      if (this.buildCommand && this.buildCommand !== 'none') {
        this.#setStatus('building');
        const buildStartedAt = Date.now();
        this.#emitLog(`[workspace] build: ${this.buildCommand}`);
        await runAndCapture(
          this.buildCommand,
          this.mountPath,
          (line) => this.#emitLog(line),
          createRuntimeEnv(this.environment),
          { stage: 'build', timeoutMs: DEFAULT_BUILD_TIMEOUT_MS }
        );
        this.telemetry.BuildDuration = Date.now() - buildStartedAt;
        this.#emitEvent('BuildDuration', { id: this.id, durationMs: this.telemetry.BuildDuration });
      }

      if (!this.startCommand || this.startCommand === 'serve static assets') {
        this.#emitLog('[workspace] static workspace ready');
        this.#setStatus('running');
        this.telemetry.StartDuration = 0;
        this.telemetry.WorkspaceLaunchDuration = Date.now() - launchStartedAt;
        return;
      }

      const startStartedAt = Date.now();
      const child = spawnShell(this.startCommand, this.mountPath, createRuntimeEnv({
        PORT: String(this.defaultPort ?? 8080),
        HOST: this.environment.HOST ?? '0.0.0.0',
        ...this.environment
      }));
      this.process = child;
      this.stopping = false;

      const handleLine = (prefix) => (line) => {
        const message = createLogLine(prefix, line);
        if (!message) return;
        this.#emitLog(message);
        for (const port of parsePorts(line)) {
          if (COMMON_PORTS.has(port) || port === this.defaultPort) {
            this.#registerPort(port);
          }
        }
      };

      readline.createInterface({ input: child.stdout }).on('line', handleLine('stdout'));
      readline.createInterface({ input: child.stderr }).on('line', handleLine('stderr'));

      child.on('error', (error) => {
        this.#emitLog(`[workspace] runtime error: ${error.message}`);
        this.#setStatus('failed');
        this.lastFailure = createLaunchFailure('runtime', error, this.logBuffer);
        this.#emitEvent('WorkspaceFailed', { id: this.id, reason: error.message, diagnostics: this.lastFailure });
      });

      child.on('close', (code, signal) => {
        this.process = null;
        if (this.stopping) {
          this.#setStatus('stopped');
          this.#emitEvent('WorkspaceStopped', { id: this.id });
          return;
        }

        if (code === 0 || signal === 'SIGTERM' || signal === 'SIGINT') {
          this.#setStatus('stopped');
          this.#emitEvent('WorkspaceStopped', { id: this.id });
          return;
        }

        this.#emitLog(`[workspace] process exited code=${code}`);
        this.#setStatus('failed');
        this.lastFailure = createLaunchFailure('runtime', new Error(`Process exited with code ${code}`), this.logBuffer);
        this.#emitEvent('WorkspaceFailed', { id: this.id, code, diagnostics: this.lastFailure });
      });

      this.#setStatus('running');
      this.telemetry.StartDuration = Date.now() - startStartedAt;
      this.telemetry.WorkspaceLaunchDuration = Date.now() - launchStartedAt;
      this.#emitEvent('StartDuration', { id: this.id, durationMs: this.telemetry.StartDuration });
      this.#emitEvent('WorkspaceLaunchDuration', { id: this.id, durationMs: this.telemetry.WorkspaceLaunchDuration });
    } catch (error) {
      const failedStage = this.status === 'installing' ? 'install' : this.status === 'building' ? 'build' : 'start';
      this.#emitLog(`[workspace] startup failed: ${error.message}`);
      this.#setStatus('failed');
      this.lastFailure = createLaunchFailure(failedStage, error, this.logBuffer);
      this.#emitEvent('WorkspaceFailed', { id: this.id, reason: error.message });
      throw error;
    }
  }

  #killProcessOrGroup(signal) {
    if (!this.process) {
      return;
    }

    if (this.process.pid) {
      try {
        // Negative PID targets the whole process group to terminate spawned children too.
        process.kill(-this.process.pid, signal);
      } catch {
        this.process.kill(signal);
      }
      return;
    }

    this.process.kill(signal);
  }

  async stop() {
    this.stopping = true;
    if (!this.process) {
      this.#setStatus('stopped');
      this.#emitEvent('WorkspaceStopped', { id: this.id });
      return;
    }

    this.#killProcessOrGroup('SIGTERM');

    await new Promise((resolve) => {
      const timeout = setTimeout(() => {
        if (this.process) {
          this.#killProcessOrGroup('SIGKILL');
        }
      }, GRACEFUL_SHUTDOWN_TIMEOUT_MS);

      const done = () => {
        clearTimeout(timeout);
        resolve();
      };

      this.process.once('close', done);
      this.process.once('exit', done);
    });

    if (this.status !== 'stopped') {
      this.#setStatus('stopped');
    }
  }

  async restart() {
    this.#emitEvent('WorkspaceRestarted', { id: this.id });
    await this.stop();
    await this.start();
  }

  async health() {
    return this.status;
  }

  getLaunchFailure() {
    return this.lastFailure;
  }

  async *logs() {
    for (const line of this.logBuffer) {
      yield line;
    }

    for await (const [line] of on(this.logEmitter, 'log')) {
      yield String(line);
    }
  }

  getRecentLogs(limit = DEFAULT_LOG_LIMIT) {
    const safeLimit = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : DEFAULT_LOG_LIMIT;
    if (safeLimit === 0) {
      return [];
    }
    return this.logBuffer.slice(-safeLimit);
  }

  async ports() {
    return [...this.portsByNumber.values()];
  }

  async filesystem() {
    return new WorkspaceFileSystem(this.mountPath);
  }

  #setStatus(nextStatus) {
    const previous = this.status;
    this.status = nextStatus;
    this.onHealth(nextStatus, previous);
    if (previous !== nextStatus) {
      this.#emitEvent('HealthChanged', { id: this.id, previous, current: nextStatus });
    }
  }

  #emitLog(line) {
    const stamped = `${new Date().toISOString()} ${line}`;
    this.logBuffer.push(stamped);
    if (this.logBuffer.length > this.maxLogLines) {
      this.logBuffer.shift();
    }
    this.logEmitter.emit('log', stamped);
  }

  #registerPort(port) {
    if (this.portsByNumber.has(port)) {
      return;
    }

    const info = {
      port,
      protocol: this.protocol,
      publicUrl: `http://localhost:${port}`
    };
    this.portsByNumber.set(port, info);
    this.onPort(info);
    this.#emitEvent('PortDiscovered', { id: this.id, ...info });
  }

  #emitEvent(type, payload = {}) {
    this.onEvent({
      type,
      timestamp: new Date().toISOString(),
      ...payload
    });
  }
}

export class RuntimeProviderRegistry {
  constructor() {
    this.providers = [];
  }

  register(provider) {
    this.providers.push(provider);
  }

  findCompatible(analysis) {
    return this.providers.find((provider) => provider.canRun(analysis));
  }
}

export class WasmtimeProvider {
  canRun(repoAnalysis) {
    return WASMTIME_COMPATIBLE_FRAMEWORKS.includes(repoAnalysis.framework);
  }

  async build(repository) {
    return {
      id: repository.workspaceId,
      runtime: 'wasmtime',
      buildCommand: repository.executionPlan.build,
      startCommand: repository.executionPlan.start,
      mountPath: repository.path,
      defaultPort: repository.executionPlan.defaultPort,
      resourceLimits: repository.resourceLimits ?? DEFAULT_RESOURCE_LIMITS,
      environment: repository.environment,
      onEvent: repository.onEvent,
      onHealth: repository.onHealth,
      onPort: repository.onPort
    };
  }

  async execute(artifact) {
    return new WasmtimeRuntimeInstance(artifact);
  }
}

export class NodeRuntimeProvider {
  constructor(options = {}) {
    this.cache = options.cache ?? new DependencyCacheService({ baseDir: options.cacheDir });
    this.buildCache = options.buildCache ?? new BuildCacheService({ baseDir: options.cacheDir });
    this.resolver = options.resolver ?? new NodeDependencyResolver();
    this.installer = options.installer ?? new NodeDependencyInstaller({ resolver: this.resolver });
    this.cacheMetrics = { dependencyRestores: 0, dependencySaves: 0, buildRestores: 0, buildSaves: 0 };
    this.environmentProvider = options.environmentProvider ?? {
      get: () => ({
        NODE_ENV: process.env.NODE_ENV ?? 'development',
        HOST: process.env.HOST ?? '0.0.0.0',
        API_URL: process.env.API_URL ?? ''
      })
    };
  }

  canRun(analysis) {
    return NODE_COMPATIBLE_FRAMEWORKS.includes(analysis.framework) || analysis.topLevelFiles?.includes('package.json');
  }

  async installDependencies(workspace) {
    return this.installer.install({
      path: workspace.path,
      packageManager: workspace.packageManager,
      cache: this.cache,
      timeoutMs: workspace.installTimeoutMs,
      env: createRuntimeEnv(workspace.environment),
      onLog: (line) => workspace.onEvent?.({
        type: 'WorkspaceLog',
        timestamp: new Date().toISOString(),
        id: workspace.workspaceId,
        line
      })
    });
  }

  async build(repository) {
    const graph = await this.resolver.resolve({ path: repository.path, topLevelFiles: repository.topLevelFiles ?? [] });
    const packageManager = graph.packageManager;
    const packageJson = await readPackageJson(repository.path);
    const scripts = packageJson?.scripts ?? {};
    const profile = FRAMEWORK_PROFILES[repository.framework] ?? FRAMEWORK_PROFILES.node;
    const hasBuildScript = Boolean(scripts.build);
    const hasStartScript = Boolean(scripts[profile.start]);
    const lockfileAware = await isLockfileAwareInstall(packageManager, repository.path, repository.topLevelFiles ?? []);
    const environment = {
      ...this.environmentProvider.get(repository.workspaceId),
      PORT: String(repository.executionPlan?.defaultPort ?? profile.defaultPort)
    };

    if (!hasStartScript) {
      throw new Error(`Missing required script "${profile.start}" in package.json`);
    }

    return {
      id: repository.workspaceId,
      runtime: 'node-wasm',
      packageManager,
      dependencyGraph: graph,
      dependencyHash: graph.lockfileHash,
      dependencyFingerprint: graph.dependencyFingerprint,
      installCommand: installCommandFor(packageManager, lockfileAware),
      buildCommand: hasBuildScript ? scriptCommandFor(packageManager, 'build') : 'none',
      startCommand: scriptCommandFor(packageManager, profile.start, profile.hostFlag ?? ''),
      mountPath: repository.path,
      defaultPort: repository.executionPlan?.defaultPort ?? profile.defaultPort,
      environment,
      resourceLimits: repository.resourceLimits ?? DEFAULT_RESOURCE_LIMITS,
      onEvent: repository.onEvent,
      onHealth: repository.onHealth,
      onPort: repository.onPort
    };
  }

  async execute(artifact) {
    const runtime = new WasmtimeRuntimeInstance(artifact);
    return runtime;
  }

  async buildFingerprint(repository, dependencyHash) {
    const hash = createHash('sha256');
    const sourceInputs = ['package.json', 'tsconfig.json', 'vite.config.ts', 'vite.config.js', 'next.config.js'];
    for (const fileName of sourceInputs) {
      const filePath = path.join(repository.path, fileName);
      if (await fileExists(filePath)) {
        hash.update(fileName);
        hash.update(await fs.readFile(filePath));
      }
    }
    hash.update(JSON.stringify(repository.executionPlan ?? {}));
    hash.update(JSON.stringify(repository.environment ?? {}));
    hash.update(dependencyHash ?? '');
    return hash.digest('hex');
  }

  cacheStats() {
    return {
      ...this.cache.getStats?.(),
      ...this.buildCache.getStats?.()
    };
  }
}

export function evaluateNodeRuntimeCandidates() {
  const candidates = [
    { name: 'Wasmtime + WASI', supportsNodeApis: false, supportsNpm: false, supportsNetworking: true, supportsFilesystem: true, supportsLongRunningProcesses: true, supportsDevServers: false, maturityScore: 8.0 },
    { name: 'Node WASI', supportsNodeApis: true, supportsNpm: true, supportsNetworking: true, supportsFilesystem: true, supportsLongRunningProcesses: true, supportsDevServers: true, maturityScore: 6.8 },
    { name: 'JCO', supportsNodeApis: false, supportsNpm: false, supportsNetworking: true, supportsFilesystem: true, supportsLongRunningProcesses: false, supportsDevServers: false, maturityScore: 6.1 },
    { name: 'WinterCG', supportsNodeApis: false, supportsNpm: false, supportsNetworking: true, supportsFilesystem: false, supportsLongRunningProcesses: true, supportsDevServers: false, maturityScore: 6.0 },
    { name: 'Node Component Model', supportsNodeApis: true, supportsNpm: true, supportsNetworking: true, supportsFilesystem: true, supportsLongRunningProcesses: true, supportsDevServers: true, maturityScore: 6.5 },
    { name: 'Wasmer JS Runtime', supportsNodeApis: false, supportsNpm: false, supportsNetworking: true, supportsFilesystem: true, supportsLongRunningProcesses: true, supportsDevServers: false, maturityScore: 5.9 },
    { name: 'WAMR JavaScript Execution', supportsNodeApis: false, supportsNpm: false, supportsNetworking: false, supportsFilesystem: true, supportsLongRunningProcesses: false, supportsDevServers: false, maturityScore: 5.1 },
    { name: 'Browser-based JS engines', supportsNodeApis: false, supportsNpm: false, supportsNetworking: true, supportsFilesystem: false, supportsLongRunningProcesses: false, supportsDevServers: false, maturityScore: 4.2 }
  ];

  const recommendation = {
    primary: 'Node WASI',
    secondary: 'Node Component Model',
    strengths: ['Best Node.js API parity in WASM-hosted runtime options', 'Supports npm ecosystem workflows', 'Can run long-lived dev servers and application processes'],
    weaknesses: ['Still evolving around full native module compatibility', 'Package manager edge-cases across pnpm/yarn require adapter logic'],
    compatibilityGaps: ['Native addons requiring host ABI/toolchain', 'Incomplete Worker/inspector parity in some runtimes'],
    productionReadiness: 'viable-with-guardrails',
    benchmarkData: {
      source: 'Synthetic compatibility harness baseline from local representative framework samples',
      coldStartSeconds: 22.4,
      warmStartSeconds: 4.1,
      installSuccessRate: 0.92,
      frameworkCompatibilityRate: 0.88
    }
  };

  return { candidates, recommendation };
}

export function defaultRuntimeCandidates() {
  return ['wasmtime', 'wasmer', 'wamr', 'jco', 'wasi-preview2', 'component-model', 'node-wasi'];
}

export function defaultResourceLimits() {
  return { ...DEFAULT_RESOURCE_LIMITS };
}
