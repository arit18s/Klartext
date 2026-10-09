import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  server: {
    host: '127.0.0.1',
    port: 5173,
    // Backend binds to localhost (07_SECURITY_GUIDELINES.md section 5).
    proxy: { '/api': 'http://127.0.0.1:8000' },
  },
})
