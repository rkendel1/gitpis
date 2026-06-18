import React, { useState, useEffect } from 'react';
import { T, LAYOUT } from '../theme.js';
import { getLanguage } from '../utils/language.js';

const s = {
  root: { height: LAYOUT.statusBarHeight, background: T.statusBar, display: 'flex', alignItems: 'center', padding: '0 12px', gap: 16, flexShrink: 0, color: T.statusBarText, fontSize: 12 },
  item: { display: 'flex', alignItems: 'center', gap: 4, opacity: 0.9, cursor: 'default' },
  sep: { opacity: 0.3 },
  right: { marginLeft: 'auto', display: 'flex', gap: 16, alignItems: 'center' },
};

export default function StatusBar({ workspace, activeFile, gitService }) {
  const [branch, setBranch] = useState('');

  useEffect(() => {
    if (!gitService) return;
    gitService.status()
      .then((r) => {
        const m = r.stdout?.match(/^## ([^.\s]+)/m);
        if (m) setBranch(m[1]);
      })
      .catch(() => {});
  }, [gitService]);

  return (
    <div style={s.root}>
      <span style={s.item}>⚡ Gitpis</span>
      {workspace && <span style={{ ...s.item, opacity: 0.7 }}>{workspace.status}</span>}
      {branch && <span style={s.item}>⎇ {branch}</span>}
      <span style={s.right}>
        {activeFile && (
          <>
            <span style={s.item}>{getLanguage(activeFile)}</span>
            <span style={s.sep}>|</span>
            <span style={s.item}>{activeFile.split('/').pop()}</span>
          </>
        )}
        <span style={s.item}>UTF-8</span>
        <span style={s.item}>LF</span>
      </span>
    </div>
  );
}
