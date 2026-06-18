export interface PortInfo {
  port: number;
  protocol: 'http' | 'https' | 'tcp';
  publicUrl?: string;
  visibility?: 'public' | 'private';
  route?: string;
}

export interface FileSystem {
  readFile(path: string, encoding?: BufferEncoding): Promise<string | Buffer>;
  writeFile(path: string, content: string | Buffer): Promise<void>;
  mkdir(path: string): Promise<void>;
  remove(path: string): Promise<void>;
  list(path?: string): Promise<string[]>;
  snapshot(snapshotPath: string): Promise<string>;
}

export type WorkspaceHealth = 'starting' | 'installing' | 'building' | 'running' | 'unhealthy' | 'stopped' | 'failed';

export interface ResourceLimits {
  memoryMb: number;
  cpuPercent: number;
  maxProcesses: number;
}

export interface Workspace {
  id: string;
  repoUrl: string;
  repoPath: string;
  framework: string;
  runtime: string;
  status: WorkspaceHealth;
  createdAt: string;
  health: WorkspaceHealth;
  resourceLimits?: ResourceLimits;
}

export interface WorkspaceEvent {
  type: string;
  timestamp: string;
  [key: string]: unknown;
}

export interface WasmWorkspace {
  launch(repoUrl: string): Promise<Workspace>;
  stop(id: string): Promise<void>;
  restart(id: string): Promise<Workspace>;
  logs(id: string): AsyncIterable<string>;
  getLogs(id: string, limit?: number): string[];
  events(id: string): Promise<WorkspaceEvent[]>;
  filesystem(id: string): Promise<FileSystem>;
  ports(id: string): Promise<PortInfo[]>;
  health(id: string): Promise<WorkspaceHealth>;
}

export interface RepositoryAnalysis {
  framework: string;
  path: string;
  topLevelFiles: string[];
  topLevelDirs: string[];
}

export interface Repository extends RepositoryAnalysis {
  executionPlan: {
    build: string;
    start: string;
    defaultPort: number;
  };
}

export interface BuildArtifact {
  id: string;
  runtime: string;
  buildCommand: string;
  startCommand: string;
  mountPath: string;
  defaultPort: number;
  resourceLimits: ResourceLimits;
}

export interface RuntimeInstance {
  id: string;
  start(): Promise<void>;
  stop(): Promise<void>;
  restart(): Promise<void>;
  health(): Promise<WorkspaceHealth>;
  logs(): AsyncIterable<string>;
  ports(): Promise<PortInfo[]>;
  filesystem(): Promise<FileSystem>;
}

export interface RuntimeProvider {
  canRun(repo: RepositoryAnalysis): boolean;
  build(repo: Repository): Promise<BuildArtifact>;
  execute(artifact: BuildArtifact): Promise<RuntimeInstance>;
}

export interface RuntimeCandidate {
  name: string;
  supportsNodeApis: boolean;
  supportsNpm: boolean;
  supportsNetworking: boolean;
  supportsFilesystem: boolean;
  supportsLongRunningProcesses: boolean;
  supportsDevServers: boolean;
  maturityScore: number;
}

export type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun';

export interface Dependency {
  name: string;
  version: string;
}

export interface DependencyGraph {
  dependencies: Dependency[];
  devDependencies: Dependency[];
  lockfileHash: string;
  dependencyFingerprint?: string;
  packageManager: PackageManager;
}

export interface DependencyResolver {
  detectManager(workspace: { path: string; topLevelFiles?: string[] }): Promise<PackageManager>;
  resolve(workspace: { path: string; topLevelFiles?: string[] }): Promise<DependencyGraph>;
}

export interface DependencyInstaller {
  install(workspace: Workspace): Promise<{ cacheHit: boolean; hash: string; command: string | null }>;
}

export interface DependencyCache {
  exists?(key: string): Promise<boolean>;
  save?(key: string, workspacePath: string, packageManager?: PackageManager): Promise<void>;
  get(hash: string): Promise<{ hash: string; path: string } | null>;
  put(hash: string, workspacePath: string): Promise<void>;
  restore?(key: string, workspacePath: string, packageManager?: PackageManager): Promise<boolean>;
}

export interface CacheArtifact {
  kind: 'dependencies' | 'builds';
  path: string;
}

export interface CacheProvider {
  put(key: string, artifact: CacheArtifact): Promise<void>;
  get(key: string, kind: CacheArtifact['kind']): Promise<CacheArtifact | null>;
}

export interface BuildCache {
  exists(hash: string): Promise<boolean>;
  restore(hash: string, workspacePath: string): Promise<boolean>;
  save(hash: string, workspacePath: string): Promise<void>;
}

export interface EnvironmentProvider {
  get(workspaceId: string): Record<string, string>;
}

export interface NodeProcess {
  pid: string;
  start(): Promise<void>;
  stop(): Promise<void>;
  restart(): Promise<void>;
  health(): Promise<WorkspaceHealth>;
}
