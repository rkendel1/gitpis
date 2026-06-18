import React, { useState, useRef, useCallback } from 'react';
import { T, LAYOUT } from '../theme.js';
import { useWorkspace } from '../hooks/useWorkspace.js';
import { useIdeServices } from '../hooks/useIdeServices.js';
import FileTree from './FileTree.jsx';
import EditorPane from './EditorPane.jsx';
import TerminalPane from './TerminalPane.jsx';
import GitPanel from './GitPanel.jsx';
import SearchPanel from './SearchPanel.jsx';
import StatusBar from './StatusBar.jsx';

const PANELS = {
  files: { icon: '📁', label: 'Explorer' },
  search: { icon: '🔍', label: 'Search' },
  git: { icon: '⎇', label: 'Source Control' },
};

const s = {
  root: { display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden', background: T.bg, color: T.text },
  body: { display: 'flex', flex: 1, overflow: 'hidden' },
  activityBar: { width: LAYOUT.activityBarWidth, background: T.bgActivityBar, display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: 8, gap: 2, flexShrink: 0, borderRight: `1px solid ${T.border}` },
  actBtn: (active) => ({ width: 40, height: 40, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 6, cursor: 'pointer', fontSize: 18, background: active ? T.bgHover : 'transparent', color: active ? T.textBright : T.textMuted, border: 'none', transition: 'background 0.1s' }),
  sidebar: (visible) => ({ width: visible ? LAYOUT.sidebarWidth : 0, background: T.bgSidebar, borderRight: visible ? `1px solid ${T.border}` : 'none', overflow: 'hidden', flexShrink: 0, display: 'flex', flexDirection: 'column', transition: 'width 0.15s' }),
  editorArea: { display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden', minWidth: 0 },
  editorMain: { flex: 1, overflow: 'hidden', display: 'flex' },
  terminalArea: { height: LAYOUT.terminalMinHeight, flexShrink: 0 },
  resizeHandle: { height: 4, background: T.border, cursor: 'row-resize', flexShrink: 0 },
  backBtn: { position: 'absolute', top: 8, right: 8, background: T.bgPanel, border: `1px solid ${T.border}`, borderRadius: 4, padding: '4px 10px', color: T.textMuted, fontSize: 11, cursor: 'pointer' },
};

export default function IDE({ workspaceId, onBack }) {
  const { workspace } = useWorkspace(workspaceId);
  const services = useIdeServices(workspaceId);

  const [activePanel, setActivePanel] = useState('files');
  const [sidebarVisible, setSidebarVisible] = useState(true);
  const [terminalVisible, setTerminalVisible] = useState(true);
  const [terminalHeight, setTerminalHeight] = useState(LAYOUT.terminalMinHeight);
  const [activeFile, setActiveFile] = useState(null);
  const editorRef = useRef(null);
  const resizing = useRef(false);

  const openFile = useCallback((path) => {
    setActiveFile(path);
    // Relay to EditorPane via its internal state (EditorPane listens via callback)
    editorRef.current?.openFile(path);
  }, []);

  function togglePanel(key) {
    if (activePanel === key) { setSidebarVisible(!sidebarVisible); }
    else { setActivePanel(key); setSidebarVisible(true); }
  }

  // Vertical resize of terminal pane
  function startResize(e) {
    resizing.current = true;
    const startY = e.clientY;
    const startH = terminalHeight;
    function onMove(ev) {
      if (!resizing.current) return;
      const delta = startY - ev.clientY;
      setTerminalHeight(Math.max(100, Math.min(600, startH + delta)));
    }
    function onUp() {
      resizing.current = false;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  // Keyboard shortcuts
  React.useEffect(() => {
    function handler(e) {
      if ((e.ctrlKey || e.metaKey) && e.key === '`') { e.preventDefault(); setTerminalVisible((v) => !v); }
      if ((e.ctrlKey || e.metaKey) && e.key === 'b') { e.preventDefault(); setSidebarVisible((v) => !v); }
    }
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  if (!services) return null;

  const { fileService, fileWatcher, terminalService, gitService, diffService, searchService } = services;

  return (
    <div style={s.root}>
      {onBack && <button style={s.backBtn} onClick={onBack}>← Workspaces</button>}

      <div style={s.body}>
        {/* Activity Bar */}
        <div style={s.activityBar}>
          {Object.entries(PANELS).map(([key, { icon, label }]) => (
            <button
              key={key}
              style={s.actBtn(activePanel === key && sidebarVisible)}
              onClick={() => togglePanel(key)}
              title={label}
            >
              {icon}
            </button>
          ))}
          <div style={{ flex: 1 }} />
          <button
            style={s.actBtn(terminalVisible)}
            onClick={() => setTerminalVisible((v) => !v)}
            title="Toggle Terminal (Ctrl+`)"
          >
            {'>'}_
          </button>
        </div>

        {/* Sidebar */}
        <div style={s.sidebar(sidebarVisible)}>
          {activePanel === 'files' && (
            <FileTree
              fileService={fileService}
              fileWatcher={fileWatcher}
              onOpen={openFile}
              activeFile={activeFile}
            />
          )}
          {activePanel === 'search' && (
            <SearchPanel searchService={searchService} onOpenFile={openFile} />
          )}
          {activePanel === 'git' && (
            <GitPanel gitService={gitService} onOpenFile={openFile} />
          )}
        </div>

        {/* Main editor + terminal */}
        <div style={s.editorArea}>
          <div style={s.editorMain}>
            <EditorPaneWrapper
              ref={editorRef}
              fileService={fileService}
              fileWatcher={fileWatcher}
              diffService={diffService}
              onFileChange={setActiveFile}
            />
          </div>

          {terminalVisible && (
            <>
              <div style={s.resizeHandle} onMouseDown={startResize} />
              <div style={{ ...s.terminalArea, height: terminalHeight }}>
                <TerminalPane terminalService={terminalService} />
              </div>
            </>
          )}
        </div>
      </div>

      <StatusBar workspace={workspace} activeFile={activeFile} gitService={gitService} />
    </div>
  );
}

// Wrapper to expose openFile imperatively via ref
const EditorPaneWrapper = React.forwardRef(function EditorPaneWrapper(props, ref) {
  const [openQueue, setOpenQueue] = useState([]);

  React.useImperativeHandle(ref, () => ({
    openFile: (path) => setOpenQueue((q) => [...q, path])
  }));

  return (
    <EditorPane
      {...props}
      openQueue={openQueue}
      onQueueDrain={() => setOpenQueue([])}
    />
  );
});
