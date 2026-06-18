import { apiFetch } from './api.js';

// Implements: interface TerminalService
export class TerminalService {
  constructor(workspaceId) {
    this.workspaceId = workspaceId;
  }

  async createTerminal(options = {}) {
    return apiFetch(`/workspaces/${this.workspaceId}/terminals`, {
      method: 'POST',
      body: JSON.stringify({ cwd: options.cwd, env: options.env })
    });
  }

  async execute(terminalId, command, args = [], options = {}) {
    return apiFetch(`/workspaces/${this.workspaceId}/terminals/${terminalId}/exec`, {
      method: 'POST',
      body: JSON.stringify({ command, args, cwd: options.cwd, env: options.env, stdin: options.stdin })
    });
  }

  async streamOutput(terminalId) {
    return apiFetch(`/workspaces/${this.workspaceId}/terminals/${terminalId}/output`);
  }

  async destroy(terminalId) {
    // Future: DELETE endpoint. For now terminal state lives in backend memory.
    return Promise.resolve();
  }
}
