// vite 配置：OOC 一等模块插件——.ooc 源码在内存 transform 成纯 ES 模块进入模块图。
// 无磁盘中间产物、无 prebuild；.ooc 内部 #import 相对 .ooc / .ts 也全部由插件 + Vite 原生解析。
// 宿主依赖（视图/信号/storage）不走全局注入：OOC 侧用 #import './bridge.ts' 显式导入。
import { defineConfig } from 'vite'
import tailwindcss from '@tailwindcss/vite'
import { oocPlugin } from 'vite-plugin-ooc'

// GitHub Pages 项目站点部署到 /ooc/example/；本地开发保持根路径。
const base = process.env.OOC_BASE ?? '/'

export default defineConfig({
    base,
    plugins: [oocPlugin(), tailwindcss()],
})
