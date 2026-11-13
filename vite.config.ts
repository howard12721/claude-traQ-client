import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 接続先の traQ。ローカルの traQ に繋ぐなら TRAQ_ORIGIN=http://localhost:3000 npm run dev
const origin = process.env.TRAQ_ORIGIN ?? 'https://q.trap.jp'

export default defineConfig({
  plugins: [react()],
  define: { __TRAQ_ORIGIN__: JSON.stringify(origin) },
  server: { proxy: { '/api': { target: origin, changeOrigin: true, ws: true } } },
})
