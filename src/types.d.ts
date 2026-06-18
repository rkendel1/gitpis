export interface PortInfo {
  port: number;
  protocol: 'http' | 'https' | 'tcp';
  publicUrl?: string;
  visibility?: 'public' | 'private';
  route?: string;
}

export interface RouteTarget {
  nodeId: string;
  workspaceId: string;
  runtimeAddress: string;
}

export interface Route {
  id: string;
  workspaceId: string;
  port: number;
  host: string;
  protocol: 'http' | 'https';
  url: string;
  target: RouteTarget;
  websocket?: boolean;
  sse?: boolean;
  createdAt?: string;
}

export interface IngressPolicy {
  allowIngress: boolean;
}

export interface EgressPolicy {
  allowedHosts: string[];
  blockedHosts: string[];
  rateLimitPerMinute?: number | null;
  internetAccess?: 'open' | 'restricted' | 'blocked';
}

export interface WorkspaceNetwork {
  workspaceId: string;
  ports: PortInfo[];
  routes: Route[];
  ingressPolicy: IngressPolicy;
  egressPolicy: EgressPolicy;
}

export interface NetworkingManager {
  allocateRoute(workspaceId: string, port: number): Promise<Route>;
  releaseRoute(workspaceId: string, routeId?: string): Promise<void>;
  discoverPorts(workspaceId: string, runtime: RuntimeInstance): Promise<PortInfo[]>;
}

export interface PortDiscoveryService {
  discover(runtime: RuntimeInstance): Promise<PortInfo[]>;
}

export interface PortRegistry {
  register(workspaceId: string, port: number): Promise<{ workspaceId: string; port: number }>;
}

export interface UrlGenerator {
  generate(workspaceId: string, port: number): string;
}

export interface RouteAllocator {
  allocate(workspaceId: string, port: number): Promise<Route>;
}

export interface ReverseProxyProvider {
  registerRoute(route: Route): Promise<void>;
  removeRoute(routeId: string): Promise<void>;
}

export interface TlsProvider {
  issueCertificate(domain: string): unknown;
  renewCertificate(domain: string): unknown;
  revokeCertificate(domain: string): void;
}

export interface CustomDomainManager {
  addDomain(workspaceId: string, domain: string, routeId?: string | null): unknown;
  verifyDomain(domain: string): unknown;
  removeDomain(domain: string): void;
}

export interface NetworkIsolationPolicy {
  allowIngress(): boolean;
  allowEgress(host: string): boolean;
  allowWorkspaceToWorkspace(sourceWorkspaceId: string, targetWorkspaceId: string): boolean;
}

export interface ServiceMeshProvider {
  registerService(name: string, target: string): void;
  discoverService(name: string): string | null;
}

export interface EventStream {
  subscribe(): Iterable<WorkspaceEvent>;
}

export interface RouteHealthChecker {
  check(route: Route): Promise<{
    routeId: string;
    workspaceId: string;
    portResponding: boolean;
    http200: boolean;
    runtimeReachable: boolean;
    proxyReachable: boolean;
    checkedAt: string;
  }>;
}

export interface FileSystem {
  readFile(path: string, encoding?: BufferEncoding): Promise<string | Buffer>;
  writeFile(path: string, content: string | Buffer): Promise<void>;
  createFile(path: string, content?: string | Buffer): Promise<void>;
  mkdir(path: string): Promise<void>;
  remove(path: string): Promise<void>;
  rename(sourcePath: string, destinationPath: string): Promise<void>;
  list(path?: string): Promise<string[]>;
  listDirectory(path?: string): Promise<string[]>;
  snapshot(snapshotPath: string): Promise<string>;
}

export interface IdeSession {
  sessionId: string;
  workspaceId: string;
  userId: string;
  createdAt: string;
}

export interface IdeProvider {
  initialize(workspaceId: string, userId?: string): Promise<IdeSession>;
  destroy(sessionId: string): Promise<void>;
}

export interface EditorBackend {
  readFile(workspaceId: string, path: string, encoding?: BufferEncoding): Promise<string | Buffer>;
  writeFile(workspaceId: string, path: string, content: string | Buffer): Promise<void>;
  watchFile(workspaceId: string, listener: (event: WorkspaceEvent) => void): () => void;
  listFiles(workspaceId: string, path?: string): Promise<string[]>;
}

export interface FileService {
  readFile(workspaceId: string, path: string, encoding?: BufferEncoding): Promise<string | Buffer>;
  writeFile(workspaceId: string, path: string, content: string | Buffer): Promise<void>;
  createFile(workspaceId: string, path: string, content?: string | Buffer): Promise<void>;
  deleteFile(workspaceId: string, path: string): Promise<void>;
  renameFile(workspaceId: string, sourcePath: string, destinationPath: string): Promise<void>;
  listDirectory(workspaceId: string, path?: string): Promise<string[]>;
}

export interface FileWatcher {
  subscribe(workspaceId: string, listener: (event: WorkspaceEvent) => void): () => void;
}

export interface TerminalSession {
  terminalId: string;
  workspaceId: string;
  createdAt: string;
  cwd?: string;
}

export interface TerminalService {
  createTerminal(workspaceId: string, options?: { cwd?: string }): Promise<TerminalSession>;
  execute(
    terminalId: string,
    command: string,
    args?: string[],
    options?: { cwd?: string; env?: Record<string, string>; stdin?: string }
  ): Promise<{ ok: boolean; code: number; stdout: string; stderr: string }>;
  streamOutput(terminalId: string): unknown[];
  destroy(terminalId: string): Promise<void>;
}

export interface GitService {
  status(workspaceId: string): Promise<{ ok: boolean; code: number; stdout: string; stderr: string }>;
  commit(
    workspaceId: string,
    message: string,
    options?: { stageAll?: boolean }
  ): Promise<{ ok: boolean; code: number; stdout: string; stderr: string; noChanges?: boolean }>;
  push(workspaceId: string, remote?: string, branch?: string): Promise<{ ok: boolean; code: number; stdout: string; stderr: string }>;
  pull(workspaceId: string, remote?: string, branch?: string): Promise<{ ok: boolean; code: number; stdout: string; stderr: string }>;
  branch(workspaceId: string, name: string): Promise<{ ok: boolean; code: number; stdout: string; stderr: string }>;
  checkout(workspaceId: string, ref: string): Promise<{ ok: boolean; code: number; stdout: string; stderr: string }>;
}

export interface DiffService {
  compare(fileA: string, fileB: string): Promise<{ inline: string; sideBySide: string[] }>;
}

export interface SearchService {
  search(
    workspaceId: string,
    query: string,
    options?: { regex?: boolean; caseSensitive?: boolean; filePattern?: string }
  ): Promise<Array<{ path: string; line: number; column: number; text: string }>>;
}

export interface LspManager {
  startServer(workspaceId: string, language: string): Promise<{ serverId: string; language: string }>;
  stopServer(serverId: string): Promise<void>;
}

export interface DebugService {
  attach(workspaceId: string, target?: string): Promise<{ sessionId: string; workspaceId: string; target?: string }>;
  detach(sessionId: string): Promise<void>;
  setBreakpoint(sessionId: string, filePath: string, line: number): Promise<void>;
  inspect(sessionId: string, expression: string): Promise<unknown>;
}

export interface PreviewService {
  getPreviewUrl(workspaceId: string): Promise<string | null>;
  refresh(workspaceId: string): Promise<{ workspaceId: string; refreshedAt: string }>;
}

export interface Presence {
  userId: string;
  cursorPosition: { line: number; column: number };
  activeFile: string;
}

export interface WorkspacePermission {
  read: boolean;
  write: boolean;
  terminal: boolean;
  admin: boolean;
}

export interface WorkspaceSocket {
  subscribe(channel: 'files' | 'terminal' | 'logs' | 'git' | 'presence' | 'runtime-events', listener: (payload: unknown) => void): () => void;
}

export type WorkspaceHealth = 'starting' | 'installing' | 'building' | 'running' | 'suspended' | 'restoring' | 'unhealthy' | 'stopped' | 'failed';

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
  environmentVariables?: Record<string, string>;
  latestSnapshotId?: string | null;
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
  snapshot(id: string): Promise<Snapshot>;
  suspend(id: string): Promise<Workspace>;
  resume(id: string): Promise<Workspace>;
  restore(id: string, snapshotId: string): Promise<Workspace>;
  listSnapshots(id: string): Promise<Snapshot[]>;
  logs(id: string): AsyncIterable<string>;
  getLogs(id: string, limit?: number): string[];
  events(id: string): Promise<WorkspaceEvent[]>;
  filesystem(id: string): Promise<FileSystem>;
  ports(id: string): Promise<PortInfo[]>;
  routes(id: string): Promise<Route[]>;
  createRoute(id: string, port?: number): Promise<Route>;
  deleteRoute(id: string, routeId: string): Promise<void>;
  workspaceNetwork(id: string): Promise<WorkspaceNetwork>;
  workspaceUrl(id: string): Promise<string | null>;
  workspaceDomains(id: string): Promise<unknown[]>;
  initializeIdeSession(workspaceId: string, userId?: string): Promise<IdeSession>;
  destroyIdeSession(sessionId: string): Promise<void>;
  fileService(): FileService;
  terminalService(): TerminalService;
  gitService(): GitService;
  workspaceSocket(): WorkspaceSocket;
  networkRoutes(): Promise<Route[]>;
  networkStats(): Promise<Record<string, number>>;
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

export interface RuntimeMetadata {
  framework: string;
  packageManager: string;
  dependencyHash: string;
  buildHash: string;
  ports: PortInfo[];
}

export interface WorkspaceState {
  id: string;
  repositoryUrl: string;
  filesystemSnapshotId: string;
  dependencySnapshotId: string;
  buildSnapshotId: string;
  environmentVariables: Record<string, string>;
  runtimeMetadata: RuntimeMetadata;
  createdAt: Date;
  updatedAt: Date;
}

export interface IncrementalSnapshot {
  baseSnapshotId: string | null;
  changedFiles: string[];
  deletedFiles: string[];
}

export interface Snapshot {
  id: string;
  workspaceId: string;
  createdAt: string;
  compression: 'gzip' | 'zstd' | 'lz4';
  environmentVariables: Record<string, string>;
  runtimeMetadata: RuntimeMetadata;
  incrementalSnapshot: IncrementalSnapshot;
}

export interface SnapshotEngine {
  create(workspaceId: string): Promise<Snapshot>;
  restore(snapshotId: string): Promise<void>;
  delete(snapshotId: string): Promise<void>;
}

export interface FilesystemJournal {
  recordChange(type: FilesystemOperationType, target: string, nextTarget?: string | null): void;
  replay(handler: (entry: unknown) => void | Promise<void>): Promise<void>;
  compact(maxEntries?: number): void;
}

export type FilesystemOperationType = 'create' | 'modify' | 'delete' | 'rename';

export interface SnapshotStorageProvider {
  save(snapshot: Snapshot): Promise<void>;
  load(snapshotId: string): Promise<Snapshot>;
  delete(snapshotId: string): Promise<void>;
}

export interface EnvironmentSnapshot {
  variables: Record<string, string>;
}

export interface WorkspaceMetadata {
  framework: string;
  packageManager: string;
  dependencyHash: string;
  buildHash: string;
  ports: PortInfo[];
  launchHistory: LaunchRecord[];
}

export interface LaunchRecord {
  timestamp: string;
  status: WorkspaceHealth;
  details?: Record<string, unknown>;
}

export interface SnapshotHistory {
  listSnapshots(workspaceId: string): Promise<Snapshot[]>;
  restoreVersion(workspaceId: string, snapshotId: string): Promise<Workspace>;
  deleteVersion(snapshotId: string): Promise<void>;
}

export interface CheckpointManager {
  createCheckpoint(workspaceId: string): Promise<Snapshot>;
  restoreCheckpoint(workspaceId: string, snapshotId: string): Promise<Workspace>;
}

export interface HibernationManager {
  suspend(workspaceId: string): Promise<Workspace>;
  resume(workspaceId: string): Promise<Workspace>;
  autoHibernate(): Promise<void>;
}

export interface WorkspaceMigrator {
  migrate(workspaceId: string, targetNode: string): Promise<void>;
}

export interface NodeProcess {
  pid: string;
  start(): Promise<void>;
  stop(): Promise<void>;
  restart(): Promise<void>;
  health(): Promise<WorkspaceHealth>;
}

export type NodeStatus = 'healthy' | 'draining' | 'offline';

export interface WorkerNode {
  id: string;
  cpuAvailable: number;
  memoryAvailable: number;
  diskAvailable: number;
  workspaceCount: number;
  status: NodeStatus;
  address?: string | null;
  costPerHour?: number;
}

export interface WorkspaceLaunchRequest {
  workspaceId?: string;
  tenantId?: string;
  repoUrl?: string;
  resources?: {
    cpu?: number;
    memory?: number;
    disk?: number;
    network?: number;
    runtimeCount?: number;
  };
}

export interface NodeAssignment {
  workspaceId: string;
  workerId: string;
  nodeId: string;
  address?: string | null;
  tenantId?: string;
  scheduledAt: string;
}

export interface Scheduler {
  schedule(request: WorkspaceLaunchRequest): Promise<NodeAssignment>;
  reschedule(workspaceId: string): Promise<NodeAssignment>;
  release(workspaceId: string): Promise<void>;
}

export interface WorkerRegistry {
  register(node: WorkerNode): void;
  unregister(nodeId: string): void;
  heartbeat(nodeId: string, metrics?: { cpu?: number; memory?: number; disk?: number; workspaces?: number }): void;
}

export interface ResourceManager {
  allocate(request: { workspaceId: string; nodeId: string; resources?: WorkspaceLaunchRequest['resources'] }): unknown;
  release(workspaceId: string): void;
  rebalance(): unknown;
}

export interface PlacementStrategy {
  selectNode(nodes: WorkerNode[], request?: WorkspaceLaunchRequest): WorkerNode | null;
}

export interface WorkQueue {
  enqueue(payload: unknown): unknown;
  dequeue(): unknown;
  retry(item: unknown, error?: Error | null): unknown;
  deadLetter(item: unknown, reason?: string): unknown;
}

export interface ClusterStateStore {
  saveWorkspace(workspace: { workspaceId: string; tenantId?: string; resources?: WorkspaceLaunchRequest['resources'] }): void;
  getWorkspace(workspaceId: string): { workspaceId: string; tenantId?: string; resources?: WorkspaceLaunchRequest['resources'] } | null;
  listWorkspaces(): { workspaceId: string; tenantId?: string; resources?: WorkspaceLaunchRequest['resources'] }[];
  saveNode(node: WorkerNode): void;
  getNodes(): WorkerNode[];
  saveWorkspaceLocation(location: WorkspaceLocation): void;
  getWorkspaceLocation(workspaceId: string): WorkspaceLocation | null;
  listWorkspaceLocations(): WorkspaceLocation[];
  removeWorkspaceLocation(workspaceId: string): void;
}

export interface WorkspaceLocation {
  workspaceId: string;
  nodeId: string;
}

export interface RecoveryManager {
  recoverWorkspace(workspaceId: string): Promise<NodeAssignment>;
}

export interface MigrationManager {
  migrate(workspaceId: string, destinationNode: string): Promise<WorkspaceLocation>;
}

export interface Autoscaler {
  scaleUp(metrics?: Record<string, number>): { action: string; reason: string };
  scaleDown(metrics?: Record<string, number>): { action: string; reason: string };
}

export interface DrainManager {
  drain(workerId: string): Promise<{ workerId: string; status: NodeStatus; affectedWorkspaces: string[]; migrated: string[] }>;
}

export interface TenantBoundary {
  tenantId: string;
}

export interface TenantQuota {
  maxWorkspaces: number;
  maxCpu: number;
  maxMemory: number;
}

export interface LogAggregator {
  ingest(entry: Record<string, unknown>): void;
  query(filter?: Record<string, string>): Record<string, unknown>[];
}

export interface MetricsCollector {
  collect(metric: Record<string, unknown>): void;
  aggregate(): { samples: number; totals: Record<string, number> };
}
