// Maps file extensions to Monaco language IDs.
// JS/TS get full language services (autocomplete, go-to-def, find refs, rename).
// Others get syntax highlighting via Monaco's built-in tokenizers.
const EXT_MAP = {
  // JavaScript / TypeScript
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  ts: 'typescript', tsx: 'typescript',
  // Python
  py: 'python', pyw: 'python',
  // Systems
  rs: 'rust', go: 'go',
  c: 'c', h: 'c', cpp: 'cpp', cc: 'cpp', cxx: 'cpp', hpp: 'cpp',
  cs: 'csharp', java: 'java', kt: 'kotlin',
  // Web
  html: 'html', htm: 'html',
  vue: 'html',     // Vue SFC: best approximation until vue-specific LSP
  svelte: 'html',  // Svelte: same
  css: 'css', scss: 'scss', less: 'less',
  // Data
  json: 'json', jsonc: 'json',
  yaml: 'yaml', yml: 'yaml',
  toml: 'ini',
  xml: 'xml',
  // Prose
  md: 'markdown', mdx: 'markdown', txt: 'plaintext',
  // Shell
  sh: 'shell', bash: 'shell', zsh: 'shell', fish: 'shell',
  // DB
  sql: 'sql',
  // Config
  env: 'ini', gitignore: 'ini', dockerfile: 'dockerfile',
  // Ruby / PHP
  rb: 'ruby', php: 'php',
  // Other
  swift: 'swift', dart: 'dart', r: 'r',
};

export function getLanguage(filePath) {
  const name = filePath.split('/').pop() ?? '';
  // Handle dotfiles like .gitignore
  if (name.startsWith('.') && !name.includes('.', 1)) {
    return EXT_MAP[name.slice(1)] ?? 'plaintext';
  }
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  return EXT_MAP[ext] ?? 'plaintext';
}

export function getIcon(filePath) {
  const lang = getLanguage(filePath);
  const icons = {
    javascript: '📄', typescript: '📘', python: '🐍', rust: '🦀',
    go: '🐹', json: '🔧', yaml: '🔧', markdown: '📝',
    html: '🌐', css: '🎨', scss: '🎨', shell: '💻', sql: '🗄️',
    dockerfile: '🐳'
  };
  return icons[lang] ?? '📄';
}
