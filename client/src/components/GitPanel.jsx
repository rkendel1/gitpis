import React, { useState, useEffect, useCallback } from 'react';
import { T } from '../theme.js';
import { parseGitStatus } from '../services/GitService.js';

const XY_LABEL = { M: 'Modified', A: 'Added', D: 'Deleted', R: 'Renamed', C: 'Copied', '?': 'Untracked', '!': 'Ignored' };
const XY_COLOR = { M: T.gitModified, A: T.gitAdded, D: T.gitDeleted, '?': T.gitUntracked, R: T.gitModified };

const s = {
  root: { height: '100%', display: 'flex', flexDirection: 'column', overflowY: 'auto' },
  header: { padding: '8px 12px', fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: T.textMuted, fontWeight: 600 },
  section: { padding: '4px 12px', fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: T.textMuted, marginTop: 8 },
  file: (hov) => ({ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 12px', cursor: 'pointer', background: hov ? T.bgHover : 'transparent' }),
  badge: (xy) => ({ fontSize: 10, color: XY_COLOR[xy?.[0]] ?? T.textMuted, fontWeight: 700, width: 14, textAlign: 'center', flexShrink: 0 }),
  fileName: { fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 },
  input: { width: '100%', background: T.bgInput, border: `1px solid ${T.border}`, borderRadius: 4, padding: '6px 10px', color: T.text, fontSize: 13, outline: 'none', resize: 'none' },
  btn: (disabled) => ({ marginTop: 8, width: '100%', background: disabled ? T.bgPanel : T.statusBar, border: `1px solid ${T.border}`, borderRadius: 4, padding: '6px 10px', color: disabled ? T.textMuted : '#fff', fontSize: 12, cursor: disabled ? 'default' : 'pointer' }),
  msg: (ok) => ({ fontSize: 12, marginTop: 6, color: ok ? T.textSuccess : T.textError, padding: '4px 8px' }),
};

function FileRow({ file, onOpen }) {
  const [hov, setHov] = useState(false);
  const xy = file.xy ?? '??';
  return (
    <div style={s.file(hov)} onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)} onClick={() => onOpen?.(file.path)}>
      <span style={s.badge(xy)} title={XY_LABEL[xy?.[0]] ?? xy}>{xy[0] === '?' ? 'U' : xy[0]}</span>
      <span style={s.fileName} title={file.path}>{file.path.split('/').pop()}</span>
      <span style={{ fontSize: 11, color: T.textMuted, flexShrink: 0 }}>{file.path.includes('/') ? file.path.split('/').slice(0, -1).join('/') : ''}</span>
    </div>
  );
}

export default function GitPanel({ gitService, onOpenFile }) {
  const [files, setFiles] = useState([]);
  const [message, setMessage] = useState('');
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await gitService.status();
      setFiles(parseGitStatus(res.stdout));
    } catch { setFiles([]); }
  }, [gitService]);

  useEffect(() => { refresh(); }, [refresh]);

  async function commit() {
    if (!message.trim()) return;
    setLoading(true);
    setStatus(null);
    try {
      const res = await gitService.commit(message.trim());
      setStatus({ ok: res.ok, text: res.ok ? `Committed: ${res.stdout.slice(0, 60)}` : res.stderr });
      if (res.ok) { setMessage(''); refresh(); }
    } catch (e) {
      setStatus({ ok: false, text: e.message });
    } finally {
      setLoading(false);
    }
  }

  async function push() {
    setLoading(true);
    setStatus(null);
    try {
      const res = await gitService.push();
      setStatus({ ok: res.ok, text: res.ok ? 'Pushed successfully' : res.stderr });
    } catch (e) {
      setStatus({ ok: false, text: e.message });
    } finally {
      setLoading(false);
    }
  }

  const staged = files.filter((f) => f.staged);
  const unstaged = files.filter((f) => !f.staged || f.unstaged);

  return (
    <div style={s.root}>
      <div style={s.header}>Source Control</div>

      <div style={{ padding: '8px 12px' }}>
        <textarea
          style={{ ...s.input, height: 60, fontFamily: 'inherit' }}
          placeholder="Commit message"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
        />
        <button style={s.btn(!message.trim() || loading)} onClick={commit} disabled={!message.trim() || loading}>
          {loading ? 'Working…' : '✓ Commit'}
        </button>
        <button style={{ ...s.btn(loading), marginTop: 4, background: T.bgPanel }} onClick={push} disabled={loading}>
          ↑ Push
        </button>
        {status && <div style={s.msg(status.ok)}>{status.text}</div>}
      </div>

      {staged.length > 0 && (
        <>
          <div style={s.section}>Staged ({staged.length})</div>
          {staged.map((f) => <FileRow key={f.path} file={f} onOpen={onOpenFile} />)}
        </>
      )}

      {unstaged.length > 0 && (
        <>
          <div style={s.section}>Changes ({unstaged.length})</div>
          {unstaged.map((f) => <FileRow key={f.path} file={f} onOpen={onOpenFile} />)}
        </>
      )}

      {files.length === 0 && (
        <div style={{ padding: '20px 12px', color: T.textMuted, fontSize: 13 }}>No changes detected</div>
      )}

      <div style={{ padding: '8px 12px', marginTop: 'auto' }}>
        <button style={{ ...s.btn(false), background: T.bgPanel, marginTop: 0 }} onClick={refresh}>↻ Refresh</button>
      </div>
    </div>
  );
}
