import { apiFetch } from './api.js';

// Implements: interface FileService
export class FileService {
  constructor(workspaceId) {
    this.workspaceId = workspaceId;
  }

  async readFile(path) {
    const data = await apiFetch(`/workspaces/${this.workspaceId}/file?path=${encodeURIComponent(path)}`);
    return data.content;
  }

  async writeFile(path, content) {
    return apiFetch(`/workspaces/${this.workspaceId}/file`, {
      method: 'PUT',
      body: JSON.stringify({ path, content })
    });
  }

  async createFile(path, content = '') {
    return apiFetch(`/workspaces/${this.workspaceId}/file`, {
      method: 'POST',
      body: JSON.stringify({ path, content })
    });
  }

  async deleteFile(path) {
    return apiFetch(`/workspaces/${this.workspaceId}/file`, {
      method: 'DELETE',
      body: JSON.stringify({ path })
    });
  }

  async renameFile(path, newPath) {
    return apiFetch(`/workspaces/${this.workspaceId}/file`, {
      method: 'PATCH',
      body: JSON.stringify({ path, newPath })
    });
  }

  async listDirectory(dirPath = '.') {
    return apiFetch(`/workspaces/${this.workspaceId}/files?path=${encodeURIComponent(dirPath)}`);
  }
}
