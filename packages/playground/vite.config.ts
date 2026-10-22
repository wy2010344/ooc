import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// 浏览器端 OOC：依赖在 Node 里才有的 `path`/`fs` 等，vite 预构建时用内置 polyfill
// GitHub Pages 项目站点部署到 /ooc/playground/；本地开发保持根路径（与 example 的 OOC_BASE 约定一致）。
const base = process.env.OOC_BASE ?? '/'

export default defineConfig({
  base,

  plugins: [react(), tailwindcss()],
  build: {
    target: 'es2022',
  },
  server: {
    port: 5781,
    host: true,
  },
})
