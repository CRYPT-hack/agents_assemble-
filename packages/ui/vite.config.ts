import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * The console is served by the daemon in production, so the dev server proxies
 * the API and the socket back to it — one origin either way.
 */
export default defineConfig({
  plugins: [react()],
  server: {
    port: 4320,
    proxy: {
      '/api': { target: 'http://127.0.0.1:4319', changeOrigin: true },
      '/ws': { target: 'ws://127.0.0.1:4319', ws: true },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
