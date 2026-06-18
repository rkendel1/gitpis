import React, { useState, useEffect, useCallback, useRef } from 'react';
import Editor, { DiffEditor, useMonaco } from '@monaco-editor/react';
import { T, LAYOUT } from '../theme.js';
import { getLanguage, getIcon } from '../utils/language.js';

const s = {
  root: { display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden', minWidth: 0 },
  tabBar: { display: 'flex', alignItems: 'center', background: T.bgTab, borderBottom: `1px solid ${T.border}`, height: LAYOUT.tabHeight, overflowX: 'auto', flexShrink: 0 },
  tab: (active) => ({
    display: 'flex', alignItems: 'center', gap: 6, padding: '0 14px', height: '100%',
    cursor: 'pointer', fontSize: 13, whiteSpace: 'nowrap', flexShrink: 0,
    background: active ? T.bgTabActive : 'transparent',
    color: active ? T.textBright : T.textMuted,
    borderRight: `1px solid ${T.border}`,
    borderTop: active ? `1px solid ${T.statusBar}` : '1px solid transparent',
    position: 'relative'
  }),
  closeBtn: { fontSize: 16, lineHeight: 1, background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', padding: '0 2px', opacity: 0.7 },
  emptyState: { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: T.textMuted, flexDirection: 'column', gap: 8 },
  dirty: { width: 8, height: 8, borderRadius: '50%', background: T.textWarning, display: 'inline-block', marginLeft: 4 },
};

const MONACO_OPTIONS = {
  fontSize: 14,
  fontFamily: "'Cascadia Code', 'Fira Code', Consolas, 'Courier New', monospace",
  fontLigatures: true,
  minimap: { enabled: true },
  automaticLayout: true,
  wordWrap: 'off',
  scrollBeyondLastLine: false,
  renderWhitespace: 'selection',
  bracketPairColorization: { enabled: true },
  guides: { bracketPairs: true, indentation: true },
  suggest: { snippetsPreventQuickSuggestions: false },
  quickSuggestions: { other: true, comments: true, strings: true },
  parameterHints: { enabled: true },
  formatOnPaste: true,
  formatOnType: false,
  tabSize: 2,
  insertSpaces: true,
  detectIndentation: true,
  renderLineHighlight: 'line',
  cursorBlinking: 'smooth',
  smoothScrolling: true,
  padding: { top: 8 },
};

export default function EditorPane({ fileService, fileWatcher, diffService, openQueue, onQueueDrain, onFileChange }) {
  const [tabs, setTabs] = useState([]); // [{path, content, dirty}]
  const [activeTab, setActiveTab] = useState(null);
  const [diffMode, setDiffMode] = useState(null); // {original, modified, language}
  const monaco = useMonaco();
  const saveInFlight = useRef(false);

  // Configure Monaco TypeScript / JavaScript defaults
  useEffect(() => {
    if (!monaco) return;
    monaco.languages.typescript.typescriptDefaults.setCompilerOptions({
      target: monaco.languages.typescript.ScriptTarget.ESNext,
      module: monaco.languages.typescript.ModuleKind.ESNext,
      moduleResolution: monaco.languages.typescript.ModuleResolutionKind.NodeJs,
      jsx: monaco.languages.typescript.JsxEmit.ReactJSX,
      allowSyntheticDefaultImports: true,
      esModuleInterop: true,
      strict: true,
    });
    monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions({
      noSemanticValidation: false,
      noSyntaxValidation: false,
    });
    monaco.languages.typescript.javascriptDefaults.setCompilerOptions({
      target: monaco.languages.typescript.ScriptTarget.ESNext,
      allowJs: true,
      checkJs: false,
    });
  }, [monaco]);

  // File watcher → reload if open file changed externally
  useEffect(() => {
    if (!fileWatcher) return;
    return fileWatcher.subscribe(({ type, path }) => {
      if (type === 'FileDeleted') {
        setTabs((prev) => prev.filter((t) => t.path !== path));
        setActiveTab((a) => (a === path ? null : a));
        return;
      }
      if (type === 'FileChanged' || type === 'FileRenamed') {
        // Silently reload if not dirty
        setTabs((prev) =>
          prev.map((t) => {
            if (t.path !== path || t.dirty) return t;
            return { ...t, _reload: true };
          })
        );
      }
    });
  }, [fileWatcher]);

  // Reload tabs flagged for reload
  useEffect(() => {
    const toReload = tabs.filter((t) => t._reload);
    if (!toReload.length) return;
    toReload.forEach(async (t) => {
      try {
        const content = await fileService.readFile(t.path);
        setTabs((prev) => prev.map((tab) => tab.path === t.path ? { ...tab, content, _reload: false } : tab));
      } catch { /* ignore */ }
    });
  }, [tabs, fileService]);

  const openFile = useCallback(async (path) => {
    const existing = tabs.find((t) => t.path === path);
    if (existing) { setActiveTab(path); return; }
    try {
      const content = await fileService.readFile(path);
      setTabs((prev) => [...prev, { path, content, dirty: false }]);
      setActiveTab(path);
      setDiffMode(null);
    } catch (e) {
      console.error('Failed to open file:', e);
    }
  }, [tabs, fileService]);

  const closeTab = useCallback((path, e) => {
    e.stopPropagation();
    setTabs((prev) => {
      const next = prev.filter((t) => t.path !== path);
      if (activeTab === path) {
        const idx = prev.findIndex((t) => t.path === path);
        setActiveTab(next[Math.min(idx, next.length - 1)]?.path ?? null);
      }
      return next;
    });
  }, [activeTab]);

  const handleChange = useCallback((path, value) => {
    setTabs((prev) => prev.map((t) => t.path === path ? { ...t, content: value, dirty: true } : t));
  }, []);

  const saveActive = useCallback(async () => {
    const tab = tabs.find((t) => t.path === activeTab);
    if (!tab || !tab.dirty || saveInFlight.current) return;
    saveInFlight.current = true;
    try {
      await fileService.writeFile(tab.path, tab.content);
      setTabs((prev) => prev.map((t) => t.path === tab.path ? { ...t, dirty: false } : t));
    } catch (e) {
      console.error('Save failed:', e);
    } finally {
      saveInFlight.current = false;
    }
  }, [tabs, activeTab, fileService]);

  // Process openQueue from parent ref
  useEffect(() => {
    if (!openQueue?.length) return;
    openQueue.forEach((path) => openFile(path));
    onQueueDrain?.();
  }, [openQueue]);

  // Notify parent of active file changes
  useEffect(() => {
    onFileChange?.(activeTab);
  }, [activeTab]);

  // Ctrl/Cmd+S to save
  useEffect(() => {
    const handler = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        saveActive();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [saveActive]);

  const activeTabData = tabs.find((t) => t.path === activeTab);

  return (
    <div style={s.root}>
      {/* Tab bar */}
      <div style={s.tabBar}>
        {tabs.map((tab) => (
          <div
            key={tab.path}
            style={s.tab(tab.path === activeTab)}
            onClick={() => { setActiveTab(tab.path); setDiffMode(null); }}
          >
            <span>{getIcon(tab.path)}</span>
            <span>{tab.path.split('/').pop()}</span>
            {tab.dirty && <span style={s.dirty} />}
            <button style={s.closeBtn} onClick={(e) => closeTab(tab.path, e)}>×</button>
          </div>
        ))}
      </div>

      {/* Editor area */}
      {diffMode ? (
        <DiffEditor
          height="100%"
          theme="vs-dark"
          original={diffMode.original}
          modified={diffMode.modified}
          language={diffMode.language}
          options={{ ...MONACO_OPTIONS, readOnly: false }}
        />
      ) : activeTabData ? (
        <Editor
          height="100%"
          theme="vs-dark"
          path={activeTabData.path}
          language={getLanguage(activeTabData.path)}
          value={activeTabData.content}
          onChange={(v) => handleChange(activeTabData.path, v ?? '')}
          options={MONACO_OPTIONS}
        />
      ) : (
        <div style={s.emptyState}>
          <div style={{ fontSize: 40 }}>⌨️</div>
          <div>Open a file to start editing</div>
          <div style={{ fontSize: 11, color: T.textMuted }}>Use the Explorer to browse workspace files</div>
        </div>
      )}
    </div>
  );
}

// Expose openFile so parent can call it via ref
export { EditorPane };
