// DOM 元素组件
export { dom, text, html } from './dom.js'
export type { DComponent } from './dom.js'

// 组件包装和 forEach
export { fc, forEach } from './fc.js'
export type { ForEachConfig } from './fc.js'

// 桥接类型源与 loader（供 OOC 类型检查器解析全局类型，Route A）
export { createBridgeGlobalsTypes, bridgeTypesSource } from './types.js'
