import { apiFetch } from './api.js';

// Implements: interface GitService
// Credential note: tokens stored in sessionStorage only — never forwarded to
// runtime processes. Future: backend credential helper per workspace.
export class GitService {
  constructor(workspaceId) {
    this.workspaceId = workspaceId;
    this._credKey = `gitpis.token.${workspaceId}`;
  }

  // ── Git operations ────────────────────────────────────────────────────────

  async status() {
    return apiFetch(`/workspaces/${this.workspaceId}/git/status`);
  }

  async commit(message, options = {}) {
    return apiFetch(`/workspaces/${this.workspaceId}/git/commit`, {
      method: 'POST',
      body: JSON.stringify({ message, stageAll: options.stageAll !== false })
    });
  }

  async push(remote = 'origin', branch) {
    return apiFetch(`/workspaces/${this.workspaceId}/git/push`, {
      method: 'POST',
      body: JSON.stringify({ remote, branch })
    });
  }

  async pull(remote = 'origin', branch) {
    // Future: POST /git/pull endpoint; currently not in server — use terminal fallback.
    return { ok: false, stdout: '', stderr: 'pull not yet exposed via REST' };
  }

  async branch(name) {
    // Future: POST /git/branch endpoint.
    return { ok: false, stdout: '', stderr: 'branch create not yet exposed via REST' };
  }

  async checkout(ref) {
    // Future: POST /git/checkout endpoint.
    return { ok: false, stdout: '', stderr: 'checkout not yet exposed via REST' };
  }

  // ── Parsed helpers ────────────────────────────────────────────────────────

  async changedFiles() {
    const { stdout } = await this.status();
    return parseGitStatus(stdout);
  }

  // ── Credential management (in-memory, session-scoped) ─────────────────────

  setToken(token) {
    sessionStorage.setItem(this._credKey, token);
  }

  getToken() {
    return sessionStorage.getItem(this._credKey);
  }

  clearToken() {
    sessionStorage.removeItem(this._credKey);
  }
}

// Parse `git status --porcelain` output into an array of changed-file records.
export function parseGitStatus(stdout) {
  if (!stdout) return [];
  return stdout
    .split('\n')
    .filter((line) => line.length >= 3 && !line.startsWith('##'))
    .map((line) => {
      const xy = line.slice(0, 2);
      const path = line.slice(3).trim();
      return { xy, path, staged: xy[0] !== ' ' && xy[0] !== '?', unstaged: xy[1] !== ' ' };
    });
}
