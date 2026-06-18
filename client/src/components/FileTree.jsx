import React, { useState, useEffect, useCallback } from 'react';
import { T } from '../theme.js';
import { getIcon } from '../utils/language.js';

const s = {
  root: { height: '100%', overflowY: 'auto', userSelect: 'none' },
  header: { padding: '8px 12px', fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: T.textMuted, fontWeight: 600 },
  row: (active, depth) => ({
    display: 'flex', alignItems: 'center', gap: 4,
    padding: `2px 8px 2px ${12 + depth * 12}px`,
    cursor: 'pointer', fontSize: 13,
    background: active ? T.bgSelected : 'transparent',
    color: active ? T.textBright : T.text,
    borderRadius: 3
  }),
  icon: { fontSize: 12, flexShrink: 0 },
  name: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  actions: { marginLeft: 'auto', display: 'flex', gap: 4, opacity: 0 },
  actionBtn: { background: 'none', border: 'none', color: T.textMuted, cursor: 'pointer', fontSize: 14, padding: '0 2px', lineHeight: 1 },
};

function TreeNode({ name, path, depth, fileService, onOpen, activeFile, onRefresh }) {
  const [expanded, setExpanded] = useState(depth === 0);
  const [children, setChildren] = useState([]);
  const [isDir, setIsDir] = useState(false);
  const [hovered, setHovered] = useState(false);

  useEffect(() => {
    // Heuristic: no extension = likely directory. We rely on listDirectory to confirm.
    const hasExt = name.includes('.');
    const looksLikeDir = !hasExt || ['src', 'lib', 'dist', 'test', 'tests', 'public', 'static', 'node_modules', 'components', 'pages', 'api', 'styles', 'utils', 'hooks', 'services'].includes(name);
    setIsDir(looksLikeDir);
  }, [name]);

  async function toggle() {
    if (!isDir) { onOpen(path); return; }
    if (!expanded) {
      try {
        const items = await fileService.listDirectory(path);
        setChildren(items);
      } catch { setChildren([]); }
    }
    setExpanded(!expanded);
  }

  async function loadChildren() {
    if (!expanded) return;
    try {
      const items = await fileService.listDirectory(path);
      setChildren(items);
    } catch { setChildren([]); }
  }

  useEffect(() => { if (expanded && isDir) loadChildren(); }, []);

  const childPath = (child) => path === '.' ? child : `${path}/${child}`;

  return (
    <>
      <div
        style={{ ...s.row(activeFile === path, depth), ...(hovered ? { background: T.bgHover } : {}) }}
        onClick={toggle}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        <span style={s.icon}>
          {isDir ? (expanded ? '▾' : '▸') : getIcon(name)}
        </span>
        <span style={s.name}>{name}</span>
        {hovered && !isDir && (
          <span style={{ ...s.actions, opacity: 1 }}>
            <button style={s.actionBtn} onClick={(e) => { e.stopPropagation(); onOpen(path); }} title="Open">↗</button>
          </span>
        )}
      </div>
      {expanded && isDir && children.map((child) => (
        <TreeNode
          key={child}
          name={child}
          path={childPath(child)}
          depth={depth + 1}
          fileService={fileService}
          onOpen={onOpen}
          activeFile={activeFile}
          onRefresh={onRefresh}
        />
      ))}
    </>
  );
}

export default function FileTree({ fileService, fileWatcher, onOpen, activeFile }) {
  const [roots, setRoots] = useState([]);
  const [refresh, setRefresh] = useState(0);

  const loadRoots = useCallback(async () => {
    try {
      const items = await fileService.listDirectory('.');
      setRoots(items.filter((f) => f !== 'node_modules' && !f.startsWith('.')));
    } catch { setRoots([]); }
  }, [fileService]);

  useEffect(() => { loadRoots(); }, [loadRoots, refresh]);

  useEffect(() => {
    if (!fileWatcher) return;
    return fileWatcher.subscribe(() => setRefresh((r) => r + 1));
  }, [fileWatcher]);

  return (
    <div style={s.root}>
      <div style={s.header}>Explorer</div>
      {roots.map((name) => (
        <TreeNode
          key={name}
          name={name}
          path={name}
          depth={0}
          fileService={fileService}
          onOpen={onOpen}
          activeFile={activeFile}
          onRefresh={() => setRefresh((r) => r + 1)}
        />
      ))}
    </div>
  );
}
