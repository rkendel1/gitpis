# gitpis

A Gitpod-compatible WebAssembly workspace execution foundation that launches repository sandboxes without Docker or VMs.

## What this repository provides

- WASM-oriented workspace engine (`InMemoryWasmWorkspace`) with lifecycle APIs.
- Repository cloning/ingestion and analysis subsystem.
- Framework detection and execution-plan generation.
- Sandboxed virtual filesystem wrapper.
- Port and virtual networking metadata layer.
- Runtime provider model with pluggable runtime candidates (Wasmtime/Wasmer/WAMR/JCO/WASI P2/component model).
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
  filesystem(id: string): FileSystem;
  ports(id: string): Promise<PortInfo[]>;
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

## Notes

This project is a production-grade starter foundation focused on architecture and integration surfaces. Runtime execution is modeled for WASI-compatible providers and can be expanded with concrete runtime adapters.
