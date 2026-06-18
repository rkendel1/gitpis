#!/usr/bin/env node
import { createWasmWorkspace } from './index.js';

const workspace = createWasmWorkspace();
const [, , command, ...args] = process.argv;

async function main() {
  if (command === 'launch' && args[0]) {
    const launched = await workspace.launch(args[0]);
    process.stdout.write(`${JSON.stringify(launched, null, 2)}\n`);
    return;
  }

  if (command === 'list') {
    process.stdout.write(`${JSON.stringify(workspace.list(), null, 2)}\n`);
    return;
  }

  if (command === 'snapshot' && args[0]) {
    const snapshot = await workspace.snapshot(args[0]);
    process.stdout.write(`${JSON.stringify(snapshot, null, 2)}\n`);
    return;
  }

  if (command === 'suspend' && args[0]) {
    const suspended = await workspace.suspend(args[0]);
    process.stdout.write(`${JSON.stringify(suspended, null, 2)}\n`);
    return;
  }

  if (command === 'resume' && args[0]) {
    const resumed = await workspace.resume(args[0]);
    process.stdout.write(`${JSON.stringify(resumed, null, 2)}\n`);
    return;
  }

  if (command === 'restore' && args[0] && args[1]) {
    const restored = await workspace.restore(args[0], args[1]);
    process.stdout.write(`${JSON.stringify(restored, null, 2)}\n`);
    return;
  }

  if (command === 'snapshots' && args[0]) {
    const snapshots = await workspace.listSnapshots(args[0]);
    process.stdout.write(`${JSON.stringify(snapshots, null, 2)}\n`);
    return;
  }

  if (command === 'workspace' && args[0] === 'routes' && args[1]) {
    const routes = await workspace.routes(args[1]);
    process.stdout.write(`${JSON.stringify(routes, null, 2)}\n`);
    return;
  }

  if (command === 'workspace' && args[0] === 'url' && args[1]) {
    const url = await workspace.workspaceUrl(args[1]);
    process.stdout.write(`${JSON.stringify({ workspaceId: args[1], url }, null, 2)}\n`);
    return;
  }

  if (command === 'workspace' && args[0] === 'domains' && args[1]) {
    const domains = await workspace.workspaceDomains(args[1]);
    process.stdout.write(`${JSON.stringify(domains, null, 2)}\n`);
    return;
  }

  process.stdout.write('Usage:\n  gitpis launch <repoUrl>\n  gitpis list\n  gitpis snapshot <workspaceId>\n  gitpis suspend <workspaceId>\n  gitpis resume <workspaceId>\n  gitpis restore <workspaceId> <snapshotId>\n  gitpis snapshots <workspaceId>\n  gitpis workspace routes <workspaceId>\n  gitpis workspace url <workspaceId>\n  gitpis workspace domains <workspaceId>\n');
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
