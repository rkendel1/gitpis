# gitpis

A Gitpod-compatible WebAssembly workspace execution foundation that launches repository sandboxes without Docker or VMs.

## Replatform direction (Issue #19)

This repository is moving to a split architecture:

- **TypeScript control plane**: API layer, orchestration logic, IDE/browser UX, and product workflows.
- **Rust execution plane**: runtime execution, scheduling, filesystem sandboxing, snapshots, networking core, isolation, and deterministic recovery.

### Rust-first modules

- WASM runtime engine and providers (`Wasmtime`/`WASI` execution layer)
- Filesystem sandbox and snapshot engine
- Scheduler, worker agent, resource manager, queueing/autoscaling, and placement
- Multi-tenant isolation enforcement
- Deterministic recovery core (log parsing/classification/repair/validation)

### TypeScript-first modules

- REST/API gateway and control-plane orchestration
- Browser IDE experience (Monaco/editor/file explorer/diff/presence/session UX)
- AI advisor and heuristic orchestration flows
- Billing/admin/compliance workflow APIs and dashboards

### Migration phases

1. **Current**: TypeScript orchestration with a minimal Rust runtime kernel.
2. **PR6–PR7 focus**: migrate scheduler, filesystem sandbox, and snapshot core to Rust.
3. **PR8–PR10 focus**: keep TypeScript at the product/control plane boundary while execution-critical paths run in Rust.

## What this repository provides

- WASM-oriented workspace engine (`InMemoryWasmWorkspace`) with lifecycle APIs.
- Repository cloning/ingestion and analysis subsystem.
- Framework detection and execution-plan generation.
- Node.js runtime provider with package-manager auto-detection (`npm`, `pnpm`, `yarn`; `bun` detection stubbed for future support).
- Dependency installation orchestration with lockfile-aware commands and local dependency cache.
- Dependency graph resolution + deterministic dependency fingerprinting.
- Build cache service for common output directories (`dist`, `build`, `.next`, `target`).
- Sandboxed virtual filesystem wrapper.
- Port and virtual networking metadata layer.
- Real process-backed Wasmtime runtime provider with lifecycle, health, logs, and port discovery.
- REST API server.
- Example CLI.
- End-to-end-style integration tests for lifecycle and detection behavior.

## API

```ts
interface WasmWorkspace {
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
  health(id: string): Promise<WorkspaceHealth>;
}
```

## Quick start

```bash
npm test
npm run start:api
npm run start:cli -- launch https://github.com/user/project.git
npm run start:cli -- snapshot <workspaceId>
npm run start:cli -- suspend <workspaceId>
npm run start:cli -- resume <workspaceId>
```

## REST API

- `POST /workspaces` with `{ "repoUrl": "..." }`
- `GET /workspaces`
- `GET /cache/stats`
- `GET /workspaces/:id`
- `POST /workspaces/:id/stop`
- `POST /workspaces/:id/restart`
- `GET /workspaces/:id/ports`
- `GET /workspaces/:id/routes`
- `POST /workspaces/:id/routes` with `{ "port": 5173 }`
- `DELETE /workspaces/:id/routes/:routeId`
- `GET /workspaces/:id/network`
- `GET /workspaces/:id/health`
- `GET /workspaces/:id/logs`
- `GET /workspaces/:id/events`
- `GET /network/routes`
- `GET /network/stats`
- `GET /workspaces/:id/files?path=.`
- `GET /workspaces/:id/file?path=src/index.js`
- `PUT /workspaces/:id/file` with `{ "path": "src/App.tsx", "content": "..." }`
- `POST /workspaces/:id/terminal` with `{ "command": "npm", "args": ["run", "dev"] }`
- `GET /workspaces/:id/git/status`
- `POST /workspaces/:id/git/commit` with `{ "message": "feat: update app" }`
- `POST /workspaces/:id/git/push` with `{ "remote": "origin", "branch": "main" }`

## CLI

- `gitpis workspace routes <workspaceId>`
- `gitpis workspace url <workspaceId>`
- `gitpis workspace domains <workspaceId>`
