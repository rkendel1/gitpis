import { useState, useEffect } from 'react';
import { apiFetch } from '../services/api.js';

export function useWorkspaceList() {
  const [workspaces, setWorkspaces] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const refresh = async () => {
    setLoading(true);
    try {
      setWorkspaces(await apiFetch('/workspaces'));
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refresh(); }, []);
  return { workspaces, loading, error, refresh };
}

export function useWorkspace(workspaceId) {
  const [workspace, setWorkspace] = useState(null);
  const [loading, setLoading] = useState(Boolean(workspaceId));

  useEffect(() => {
    if (!workspaceId) return;
    setLoading(true);
    apiFetch(`/workspaces/${workspaceId}`)
      .then(setWorkspace)
      .catch(() => setWorkspace(null))
      .finally(() => setLoading(false));
  }, [workspaceId]);

  return { workspace, loading };
}
