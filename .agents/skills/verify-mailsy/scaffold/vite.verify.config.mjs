// VERIFICATION SCAFFOLDING: serves the real renderer sources over HTTP so a
// headless browser can drive them with a fixture window.api mock. Not shipped,
// not part of the app build (see electron.vite.config.ts for the real config).
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot =
  process.env.VERIFY_MAILSY_REPO || resolve(here, '..', '..', '..', '..')

export default defineConfig({
  root: resolve(repoRoot, 'src/renderer'),
  plugins: [react()],
  resolve: {
    alias: {
      '@renderer': resolve(repoRoot, 'src/renderer/src')
    }
  },
  server: {
    host: '127.0.0.1',
    port: parseInt(process.env.VERIFY_MAILSY_PORT || '4317', 10),
    strictPort: true
  }
})
