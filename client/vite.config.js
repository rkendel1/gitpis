import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/workspaces': 'http://localhost:8088',
      '/network': 'http://localhost:8088',
      '/cluster': 'http://localhost:8088',
      '/internal': 'http://localhost:8088',
      '/cache': 'http://localhost:8088'
    }
  }
});
