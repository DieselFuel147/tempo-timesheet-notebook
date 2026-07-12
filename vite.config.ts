import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The React app runs on the Vite dev server (PORT, default 5173) and proxies
// API calls to the Fastify backend (API_PORT, default 3000), so the browser
// only ever talks to one origin.
const uiPort = Number(process.env.PORT) || 5173
const apiPort = Number(process.env.API_PORT) || 3000
const tauriHost = process.env.TAURI_DEV_HOST

export default defineConfig({
  plugins: [react()],
  server: {
    host: tauriHost || 'localhost',
    hmr: tauriHost
      ? {
          protocol: 'ws',
          host: tauriHost,
          port: uiPort,
        }
      : undefined,
    port: uiPort,
    strictPort: true,
    proxy: {
      '/api': `http://127.0.0.1:${apiPort}`,
    },
  },
})
