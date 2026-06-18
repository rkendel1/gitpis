export class RuntimeProviderRegistry {
  constructor() {
    this.providers = [];
  }

  register(provider) {
    this.providers.push(provider);
  }

  findCompatible(analysis) {
    return this.providers.find((provider) => provider.canRun(analysis));
  }
}

export class WasmtimeProvider {
  canRun(repoAnalysis) {
    return ['node', 'rust', 'go', 'python', 'static', 'vite', 'react', 'vue', 'svelte', 'nextjs'].includes(repoAnalysis.framework);
  }

  async build(repository) {
    return {
      runtime: 'wasmtime',
      command: repository.executionPlan.build,
      repoPath: repository.path
    };
  }

  async execute(artifact) {
    return {
      runtime: artifact.runtime,
      command: artifact.command,
      status: 'ready'
    };
  }
}

export function defaultRuntimeCandidates() {
  return ['wasmtime', 'wasmer', 'wamr', 'jco', 'wasi-preview2', 'component-model'];
}
