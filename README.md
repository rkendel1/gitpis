# gitpis

A Gitpod-compatible WebAssembly workspace execution foundation that launches repository sandboxes without Docker or VMs.

## What this repository provides

- WASM-oriented workspace engine (`InMemoryWasmWorkspace`) with lifecycle APIs.
- Repository cloning/ingestion and analysis subsystem.
- Framework detection and execution-plan generation.
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
```

## REST API

- `POST /workspaces` with `{ "repoUrl": "..." }`
- `GET /workspaces`
- `GET /workspaces/:id`
- `POST /workspaces/:id/stop`
- `POST /workspaces/:id/restart`
- `GET /workspaces/:id/ports`
- `GET /workspaces/:id/health`
- `GET /workspaces/:id/logs`
- `GET /workspaces/:id/events`
