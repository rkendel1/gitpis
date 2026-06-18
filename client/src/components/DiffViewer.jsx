import React, { useState, useEffect } from 'react';
import { DiffEditor } from '@monaco-editor/react';
import { T } from '../theme.js';
import { getLanguage } from '../utils/language.js';

const s = {
  root: { display: 'flex', flexDirection: 'column', height: '100%' },
  header: { display: 'flex', alignItems: 'center', gap: 12, padding: '6px 12px', background: T.bgPanel, borderBottom: `1px solid ${T.border}`, fontSize: 12, color: T.textMuted, flexShrink: 0 },
  path: { color: T.textBright, fontFamily: 'monospace' },
  arrow: { color: T.textMuted },
};

const DIFF_OPTIONS = {
  fontSize: 13,
  fontFamily: "'Cascadia Code', Consolas, monospace",
  minimap: { enabled: false },
  automaticLayout: true,
  renderSideBySide: true,
  readOnly: true,
  scrollBeyondLastLine: false,
};

export default function DiffViewer({ original, modified, pathA, pathB }) {
  const language = getLanguage(pathB ?? pathA ?? '');
  return (
    <div style={s.root}>
      <div style={s.header}>
        <span style={s.path}>{pathA}</span>
        <span style={s.arrow}>→</span>
        <span style={s.path}>{pathB}</span>
      </div>
      <DiffEditor
        height="100%"
        theme="vs-dark"
        original={original ?? ''}
        modified={modified ?? ''}
        language={language}
        options={DIFF_OPTIONS}
      />
    </div>
  );
}
