import { apiFetch } from './api.js';

// Implements: interface SearchService { search(query, options): Promise<SearchResult[]> }
// SearchResult: { path, line, column, text }
export class SearchService {
  constructor(workspaceId) {
    this.workspaceId = workspaceId;
  }

  async search(query, options = {}) {
    if (!query) return [];
    const params = new URLSearchParams({ q: query });
    if (options.regex) params.set('regex', 'true');
    if (options.caseSensitive) params.set('caseSensitive', 'true');
    if (options.filePattern) params.set('path', options.filePattern);
    return apiFetch(`/workspaces/${this.workspaceId}/search?${params}`);
  }

  // File-name-only search (fast, no content reads).
  async searchFiles(query, options = {}) {
    return this.search(query, { ...options, filePattern: options.filePattern });
  }
}
