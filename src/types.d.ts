export interface PortInfo {
  port: number;
  protocol: 'http' | 'https' | 'tcp';
  visibility: 'public' | 'private';
  route: string;
}

export interface FileSystem {
  readFile(path: string, encoding?: BufferEncoding): Promise<string | Buffer>;
  writeFile(path: string, content: string | Buffer): Promise<void>;
  list(path?: string): Promise<string[]>;
  snapshot(snapshotPath: string): Promise<string>;
}

export interface Workspace {
  id: string;
  repoUrl: string;
  repoPath: string;
  framework: string;
  runtime: string;
  status: 'running' | 'stopped';
  createdAt: string;
  health: 'healthy' | 'stopped';
}

export interface WasmWorkspace {
  launch(repoUrl: string): Promise<Workspace>;
  stop(id: string): Promise<void>;
  restart(id: string): Promise<Workspace>;
  logs(id: string): AsyncIterable<string>;
  filesystem(id: string): FileSystem;
  ports(id: string): Promise<PortInfo[]>;
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
  runtime: string;
  command: string;
  repoPath: string;
}

export interface RuntimeInstance {
  runtime: string;
  command: string;
  status: string;
}

export interface RuntimeProvider {
  canRun(repo: RepositoryAnalysis): boolean;
  build(repo: Repository): Promise<BuildArtifact>;
  execute(artifact: BuildArtifact): Promise<RuntimeInstance>;
}
