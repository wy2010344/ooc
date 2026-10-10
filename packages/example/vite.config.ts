// vite 配置：OOC 一等模块插件——.ooc 源码在内存 transform 成纯 ES 模块进模块图，
// 无磁盘中间产物、无 prebuild；.ooc 内部 #import 相对/.ts 也全部由本插件 + vite 原生解析。
// globals 指向默认导出宿主桥接对象的模块（各 .ooc 产物静态 import 它）。
import { defineConfig } from 'vite'
import { oocPlugin } from 'vite-plugin-ooc'

export default defineConfig({
    plugins: [oocPlugin({ globals: '/src/bridge-globals.ts' })],
})
