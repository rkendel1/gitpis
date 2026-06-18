import React, { useState, useEffect, useRef, useCallback } from 'react';
import { T } from '../theme.js';

const s = {
  root: { display: 'flex', flexDirection: 'column', background: T.bgTerminal, borderTop: `1px solid ${T.border}`, height: '100%' },
  tabBar: { display: 'flex', alignItems: 'center', background: T.bgPanel, borderBottom: `1px solid ${T.border}`, height: 30, flexShrink: 0, gap: 0 },
  tab: (active) => ({
    padding: '0 14px', height: '100%', display: 'flex', alignItems: 'center',
    fontSize: 12, cursor: 'pointer', gap: 6,
    background: active ? T.bgTerminal : 'transparent',
    color: active ? T.textBright : T.textMuted,
    borderRight: `1px solid ${T.border}`
  }),
  addBtn: { marginLeft: 4, background: 'none', border: 'none', color: T.textMuted, cursor: 'pointer', fontSize: 18, padding: '0 8px', lineHeight: 1 },
  closeBtn: { background: 'none', border: 'none', color: T.textMuted, cursor: 'pointer', fontSize: 15, padding: '0 2px' },
  output: { flex: 1, overflowY: 'auto', padding: '8px 12px', fontFamily: "'Cascadia Code', Consolas, monospace", fontSize: 13, lineHeight: 1.5 },
  inputRow: { display: 'flex', alignItems: 'center', padding: '4px 12px', borderTop: `1px solid ${T.border}`, flexShrink: 0 },
  prompt: { color: '#4ec9b0', marginRight: 8, fontFamily: 'monospace', fontSize: 13 },
  input: { flex: 1, background: 'transparent', border: 'none', outline: 'none', color: T.text, fontFamily: "'Cascadia Code', Consolas, monospace", fontSize: 13 },
  line: { margin: '1px 0' },
  stdout: { color: T.text },
  stderr: { color: T.textError },
  exitOk: { color: T.textSuccess, fontSize: 11 },
  exitFail: { color: T.textError, fontSize: 11 },
  cmd: { color: '#569cd6' },
};

let termCounter = 0;

function TerminalSession({ terminalService, onCreated }) {
  const [terminalId, setTerminalId] = useState(null);
  const [history, setHistory] = useState([]);
  const [input, setInput] = useState('');
  const [running, setRunning] = useState(false);
  const [cmdHistory, setCmdHistory] = useState([]);
  const [cmdIdx, setCmdIdx] = useState(-1);
  const outputRef = useRef(null);

  useEffect(() => {
    terminalService.createTerminal().then((t) => {
      setTerminalId(t.terminalId);
      onCreated?.(t.terminalId);
    });
  }, []);

  useEffect(() => {
    outputRef.current?.scrollTo(0, outputRef.current.scrollHeight);
  }, [history]);

  const run = useCallback(async () => {
    if (!input.trim() || !terminalId || running) return;
    const cmd = input.trim();
    setInput('');
    setCmdHistory((h) => [cmd, ...h].slice(0, 100));
    setCmdIdx(-1);
    setRunning(true);

    const parts = cmd.split(/\s+/);
    const command = parts[0];
    const args = parts.slice(1);

    setHistory((h) => [...h, { type: 'cmd', text: `$ ${cmd}` }]);
    try {
      const result = await terminalService.execute(terminalId, command, args);
      if (result.stdout) setHistory((h) => [...h, { type: 'stdout', text: result.stdout }]);
      if (result.stderr) setHistory((h) => [...h, { type: 'stderr', text: result.stderr }]);
      setHistory((h) => [...h, { type: result.ok ? 'exitOk' : 'exitFail', text: `exit ${result.code}` }]);
    } catch (e) {
      setHistory((h) => [...h, { type: 'stderr', text: e.message }]);
    } finally {
      setRunning(false);
    }
  }, [input, terminalId, running, terminalService]);

  function handleKey(e) {
    if (e.key === 'Enter') { run(); return; }
    if (e.key === 'ArrowUp') {
      const next = Math.min(cmdIdx + 1, cmdHistory.length - 1);
      setCmdIdx(next);
      setInput(cmdHistory[next] ?? '');
    }
    if (e.key === 'ArrowDown') {
      const next = Math.max(cmdIdx - 1, -1);
      setCmdIdx(next);
      setInput(next === -1 ? '' : cmdHistory[next]);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
      <div ref={outputRef} style={s.output}>
        {history.map((line, i) => (
          <div key={i} style={{ ...s.line, ...s[line.type] }}>
            {line.text.split('\n').map((l, j) => <div key={j}>{l || ' '}</div>)}
          </div>
        ))}
        {running && <div style={{ ...s.line, color: T.textMuted }}>running…</div>}
      </div>
      <div style={s.inputRow}>
        <span style={s.prompt}>❯</span>
        <input
          style={s.input}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKey}
          placeholder={terminalId ? 'enter command…' : 'initializing…'}
          disabled={!terminalId || running}
          autoFocus
        />
      </div>
    </div>
  );
}

export default function TerminalPane({ terminalService }) {
  const [sessions, setSessions] = useState(() => [{ id: ++termCounter, label: 'Terminal 1' }]);
  const [activeId, setActiveId] = useState(1);

  function addSession() {
    const id = ++termCounter;
    setSessions((s) => [...s, { id, label: `Terminal ${id}` }]);
    setActiveId(id);
  }

  function closeSession(id, e) {
    e.stopPropagation();
    setSessions((s) => {
      const next = s.filter((t) => t.id !== id);
      if (activeId === id) setActiveId(next[next.length - 1]?.id ?? null);
      return next;
    });
  }

  return (
    <div style={s.root}>
      <div style={s.tabBar}>
        {sessions.map((sess) => (
          <div key={sess.id} style={s.tab(sess.id === activeId)} onClick={() => setActiveId(sess.id)}>
            <span>{'>'}_</span>
            <span>{sess.label}</span>
            {sessions.length > 1 && (
              <button style={s.closeBtn} onClick={(e) => closeSession(sess.id, e)}>×</button>
            )}
          </div>
        ))}
        <button style={s.addBtn} onClick={addSession} title="New Terminal">+</button>
      </div>
      {sessions.map((sess) => (
        <div key={sess.id} style={{ display: sess.id === activeId ? 'flex' : 'none', flex: 1, overflow: 'hidden', flexDirection: 'column' }}>
          <TerminalSession terminalService={terminalService} />
        </div>
      ))}
    </div>
  );
}
