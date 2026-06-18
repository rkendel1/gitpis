#!/usr/bin/env node
import { createWasmWorkspace } from './index.js';

const workspace = createWasmWorkspace();
const [, , command, arg] = process.argv;

async function main() {
  if (command === 'launch' && arg) {
    const launched = await workspace.launch(arg);
    process.stdout.write(`${JSON.stringify(launched, null, 2)}\n`);
    return;
  }

  if (command === 'list') {
    process.stdout.write(`${JSON.stringify(workspace.list(), null, 2)}\n`);
    return;
  }

  process.stdout.write('Usage:\n  gitpis launch <repoUrl>\n  gitpis list\n');
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
