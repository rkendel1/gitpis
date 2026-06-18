import path from 'node:path';
import fs from 'node:fs/promises';

const FRAMEWORK_RULES = [
  { framework: 'nextjs', files: ['next.config.js', 'next.config.mjs', 'next.config.ts'] },
  { framework: 'vite', files: ['vite.config.js', 'vite.config.ts', 'vite.config.mjs'] },
  { framework: 'react', files: ['src/App.tsx', 'src/App.jsx'] },
  { framework: 'vue', files: ['src/App.vue'] },
  { framework: 'svelte', files: ['svelte.config.js', 'svelte.config.cjs'] },
  { framework: 'rust', files: ['Cargo.toml'] },
  { framework: 'go', files: ['go.mod'] },
  { framework: 'python', files: ['pyproject.toml', 'requirements.txt'] },
  { framework: 'node', files: ['package.json'] }
];

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function detectFramework(repoPath) {
  for (const rule of FRAMEWORK_RULES) {
    for (const relFile of rule.files) {
      if (await fileExists(path.join(repoPath, relFile))) {
        return rule.framework;
      }
    }
  }
  return 'static';
}

export function generateExecutionPlan(framework) {
  const table = {
    nextjs: { build: 'npm run build', start: 'npm run start', defaultPort: 3000 },
    vite: { build: 'npm run build', start: 'npm run dev -- --host 0.0.0.0', defaultPort: 5173 },
    react: { build: 'npm run build', start: 'npm run start', defaultPort: 3000 },
    vue: { build: 'npm run build', start: 'npm run dev -- --host 0.0.0.0', defaultPort: 5173 },
    svelte: { build: 'npm run build', start: 'npm run dev -- --host 0.0.0.0', defaultPort: 5173 },
    rust: { build: 'cargo build --release', start: './target/release/app', defaultPort: 8080 },
    go: { build: 'go build ./...', start: 'go run .', defaultPort: 8080 },
    python: { build: 'python -m compileall .', start: 'python app.py', defaultPort: 8000 },
    node: { build: 'npm run build --if-present', start: 'npm run start', defaultPort: 3000 },
    static: { build: 'none', start: 'serve static assets', defaultPort: 8080 }
  };

  return table[framework] ?? table.static;
}
