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

  process.stdout.write('Usage:\n  gitpis launch <repoUrl>\n  gitpis list\n  gitpis snapshot <workspaceId>\n  gitpis suspend <workspaceId>\n  gitpis resume <workspaceId>\n  gitpis restore <workspaceId> <snapshotId>\n  gitpis snapshots <workspaceId>\n');
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
