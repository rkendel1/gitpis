import React, { useState, useCallback, useRef } from 'react';
import { T } from '../theme.js';

const s = {
  root: { height: '100%', display: 'flex', flexDirection: 'column', overflowY: 'auto' },
  header: { padding: '8px 12px', fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: T.textMuted, fontWeight: 600 },
  inputRow: { padding: '4px 12px 8px' },
  input: { width: '100%', background: T.bgInput, border: `1px solid ${T.border}`, borderRadius: 4, padding: '5px 10px', color: T.text, fontSize: 13, outline: 'none' },
  optRow: { display: 'flex', gap: 8, marginTop: 4 },
  opt: (on) => ({ fontSize: 11, padding: '2px 6px', borderRadius: 3, cursor: 'pointer', background: on ? T.bgSelected : T.bgPanel, color: on ? T.textBright : T.textMuted, border: `1px solid ${T.border}` }),
  result: (hov) => ({ padding: '4px 12px', cursor: 'pointer', background: hov ? T.bgHover : 'transparent' }),
  resPath: { fontSize: 12, color: T.textLink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  resText: { fontSize: 12, color: T.textMuted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 1 },
  resLine: { fontSize: 11, color: T.textMuted },
  empty: { padding: '16px 12px', color: T.textMuted, fontSize: 13 },
  count: { padding: '4px 12px', fontSize: 11, color: T.textMuted },
};

function ResultRow({ hit, onOpen }) {
  const [hov, setHov] = useState(false);
  return (
    <div style={s.result(hov)} onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      onClick={() => onOpen?.(hit.path, hit.line)}>
      <div style={s.resPath}>{hit.path}</div>
      {hit.text && <div style={s.resText}>{hit.text.trim()}</div>}
      {hit.line > 0 && <div style={s.resLine}>line {hit.line}</div>}
    </div>
  );
}

export default function SearchPanel({ searchService, onOpenFile }) {
  const [query, setQuery] = useState('');
  const [regex, setRegex] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const debounce = useRef(null);

  const search = useCallback(async (q, opts) => {
    if (!q.trim()) { setResults([]); setSearched(false); return; }
    setSearching(true);
    try {
      const hits = await searchService.search(q, opts);
      setResults(hits);
      setSearched(true);
    } catch { setResults([]); }
    setSearching(false);
  }, [searchService]);

  function handleInput(val) {
    setQuery(val);
    clearTimeout(debounce.current);
    debounce.current = setTimeout(() => search(val, { regex, caseSensitive }), 400);
  }

  function toggle(setter, val) {
    const next = !val;
    setter(next);
    if (query) search(query, { regex: next === setter(regex) ? next : regex, caseSensitive: next === setter(caseSensitive) ? next : caseSensitive });
  }

  return (
    <div style={s.root}>
      <div style={s.header}>Search</div>
      <div style={s.inputRow}>
        <input
          style={s.input}
          placeholder="Search (press Enter)"
          value={query}
          onChange={(e) => handleInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && search(query, { regex, caseSensitive })}
        />
        <div style={s.optRow}>
          <button style={s.opt(caseSensitive)} onClick={() => { const n = !caseSensitive; setCaseSensitive(n); if (query) search(query, { regex, caseSensitive: n }); }}>Aa</button>
          <button style={s.opt(regex)} onClick={() => { const n = !regex; setRegex(n); if (query) search(query, { regex: n, caseSensitive }); }}>.*</button>
        </div>
      </div>

      {searching && <div style={s.empty}>Searching…</div>}
      {!searching && searched && results.length === 0 && <div style={s.empty}>No results for "{query}"</div>}
      {!searching && results.length > 0 && (
        <>
          <div style={s.count}>{results.length} result{results.length !== 1 ? 's' : ''}</div>
          {results.map((hit, i) => <ResultRow key={i} hit={hit} onOpen={onOpenFile} />)}
        </>
      )}
    </div>
  );
}
