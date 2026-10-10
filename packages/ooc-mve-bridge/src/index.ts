// DOM 元素组件
export { dom, text, html } from './dom.js'
export type { DComponent } from './dom.js'

// 组件包装 / forEach
export { fc, forEach } from './fc.js'
export type { ForEachConfig } from './fc.js'

// 响应式信号 + language 原生原语：OOC 侧直接 import 使用，不需要 globals 注入
export { createSignal, memo, addEffect } from 'wy-helper'
export { createContext } from 'mve-core'
export { storage, js, delegate } from 'object-oriented-c-language'

// 桥接类型源与 loader（供 OOC 类型检查器解析全局类型，Route A）
export { createBridgeGlobalsTypes, bridgeTypesSource } from './types.js'

// 解释器路径的宿主对象集合（interpret/playground 笔记本用；codegen 走普通 import）
export { createBridgeGlobals } from './globals.js'