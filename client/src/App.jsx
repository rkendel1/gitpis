import React, { useState, useEffect } from 'react';
import WorkspacePicker from './components/WorkspacePicker.jsx';
import IDE from './components/IDE.jsx';

function getWorkspaceFromUrl() {
  const params = new URLSearchParams(window.location.search);
  return params.get('workspaceId') ?? null;
}

function setWorkspaceInUrl(id) {
  const url = new URL(window.location.href);
  if (id) url.searchParams.set('workspaceId', id);
  else url.searchParams.delete('workspaceId');
  window.history.pushState({}, '', url);
}

export default function App() {
  const [workspaceId, setWorkspaceId] = useState(() => getWorkspaceFromUrl());

  useEffect(() => {
    const onPop = () => setWorkspaceId(getWorkspaceFromUrl());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  function select(id) {
    setWorkspaceId(id);
    setWorkspaceInUrl(id);
  }

  function back() {
    setWorkspaceId(null);
    setWorkspaceInUrl(null);
  }

  if (!workspaceId) return <WorkspacePicker onSelect={select} />;
  return <IDE workspaceId={workspaceId} onBack={back} />;
}
