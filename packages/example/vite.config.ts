// vite 配置：OOC 一等模块插件 —— .ooc 源码在内存 transform 进模块图，
// 无磁盘中间产物、无 prebuild；.ooc 内部 #import 相对/包/.ts 也全部由本插件 + vite 原生解析。
import { defineConfig } from 'vite'
import { oocPlugin } from 'vite-plugin-ooc'

export default defineConfig({
    plugins: [oocPlugin()],
})