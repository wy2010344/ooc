import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// 浏览器端 OOC：依赖在 Node 里才有的 `path`/`fs` 等，vite 预构建时用内置 polyfill
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    target: 'es2022',
  },
  server: {
    host: true,
  },
})