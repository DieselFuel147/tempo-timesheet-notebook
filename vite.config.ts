import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The React app runs on 5173 in dev and proxies API calls to the Fastify
// backend on 3000, so the browser only ever talks to one origin.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
})
