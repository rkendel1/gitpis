import React, { useState } from 'react';
import { useWorkspaceList } from '../hooks/useWorkspace.js';
import { apiFetch } from '../services/api.js';
import { T } from '../theme.js';

const s = {
  root: { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 24, background: T.bg, color: T.text },
  title: { fontSize: 28, fontWeight: 600, color: T.textBright },
  subtitle: { color: T.textMuted, fontSize: 13 },
  card: { background: T.bgPanel, border: `1px solid ${T.border}`, borderRadius: 6, padding: '20px 28px', width: 440 },
  label: { display: 'block', marginBottom: 6, color: T.textMuted, fontSize: 12, textTransform: 'uppercase', letterSpacing: 1 },
  input: { width: '100%', background: T.bgInput, border: `1px solid ${T.border}`, borderRadius: 4, padding: '6px 10px', color: T.text, fontSize: 13, outline: 'none' },
  btn: { marginTop: 12, width: '100%', background: T.statusBar, border: 'none', borderRadius: 4, padding: '8px 16px', color: '#fff', fontSize: 13, cursor: 'pointer', fontWeight: 500 },
  divider: { borderTop: `1px solid ${T.border}`, margin: '20px 0' },
  wsRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0', borderBottom: `1px solid ${T.border}`, cursor: 'pointer' },
  wsName: { fontSize: 13, color: T.text },
  wsMeta: { fontSize: 11, color: T.textMuted },
  badge: (status) => ({
    fontSize: 10, padding: '2px 6px', borderRadius: 10, background:
      status === 'running' ? '#1a3a1a' : status === 'failed' ? '#3a1a1a' : '#2a2a1a',
    color: status === 'running' ? T.textSuccess : status === 'failed' ? T.textError : T.textWarning
  }),
};

export default function WorkspacePicker({ onSelect }) {
  const { workspaces, loading, refresh } = useWorkspaceList();
  const [repoUrl, setRepoUrl] = useState('');
  const [launching, setLaunching] = useState(false);
  const [error, setError] = useState('');

  async function launch() {
    if (!repoUrl.trim()) return;
    setLaunching(true);
    setError('');
    try {
      const ws = await apiFetch('/workspaces', {
        method: 'POST',
        body: JSON.stringify({ repoUrl: repoUrl.trim() })
      });
      onSelect(ws.id);
    } catch (e) {
      setError(e.message);
    } finally {
      setLaunching(false);
    }
  }

  return (
    <div style={s.root}>
      <div>
        <div style={s.title}>Gitpis IDE</div>
        <div style={s.subtitle}>Cloud workspace development environment</div>
      </div>

      <div style={s.card}>
        <label style={s.label}>Launch new workspace</label>
        <input
          style={s.input}
          placeholder="git repository URL or local path"
          value={repoUrl}
          onChange={(e) => setRepoUrl(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && launch()}
        />
        {error && <div style={{ color: T.textError, fontSize: 12, marginTop: 6 }}>{error}</div>}
        <button style={s.btn} onClick={launch} disabled={launching}>
          {launching ? 'Launching…' : 'Launch Workspace'}
        </button>

        {workspaces.length > 0 && (
          <>
            <div style={s.divider} />
            <label style={s.label}>Existing workspaces</label>
            {workspaces.map((ws) => (
              <div key={ws.id} style={s.wsRow} onClick={() => onSelect(ws.id)}>
                <div>
                  <div style={s.wsName}>{ws.repoUrl?.split('/').pop() ?? ws.id.slice(0, 8)}</div>
                  <div style={s.wsMeta}>{ws.repoUrl}</div>
                </div>
                <span style={s.badge(ws.status)}>{ws.status}</span>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
