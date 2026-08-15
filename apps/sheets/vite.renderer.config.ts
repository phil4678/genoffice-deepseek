import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// renderer-only dev server (embedded by the shell via SHEETS_RENDERER_URL for HMR; no standalone Electron)
export default defineConfig({
  root: 'src/renderer',
  plugins: [react()],
  server: {
    // 127.0.0.1 (not localhost): on Windows Node binds localhost to ::1 only,
    // while Chromium may resolve it to 127.0.0.1 first -> the dev tab never loads
    host: '127.0.0.1',
    port: Number(process.env.SHEETS_DEV_PORT) || 5174,
    strictPort: true,
  },
})
