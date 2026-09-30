import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// API_URL lets e2e tests run a second stack on other ports.
const api = process.env.API_URL ?? 'http://localhost:3000';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/api': api,
      '/ws': { target: api.replace(/^http/, 'ws'), ws: true },
    },
  },
  build: { target: 'es2022', sourcemap: true },
});
