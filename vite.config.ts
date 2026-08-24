import { readFileSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The React app is served by Vite in dev and bundled into ../dist for the
// Tauri shell to load. All backend work goes through native Tauri commands
// (see src/api/desktopApi.ts) — there is no HTTP backend to proxy to.
const pkg = JSON.parse(readFileSync('./package.json', 'utf8')) as { version: string }
const uiPort = Number(process.env.PORT) || 5173
const tauriHost = process.env.TAURI_DEV_HOST

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  resolve: {
    alias: {
      '@app': fileURLToPath(new URL('./src', import.meta.url)),
      '@shared': fileURLToPath(new URL('./shared', import.meta.url)),
    },
  },
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
  },
})
