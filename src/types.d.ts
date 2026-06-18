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

export type WorkspaceHealth = 'starting' | 'running' | 'unhealthy' | 'stopped' | 'failed';

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
