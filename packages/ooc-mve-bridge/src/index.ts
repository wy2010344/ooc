// DOM 元素组件
export { dom, text, html } from './dom.js'
export type { DComponent } from './dom.js'

// 组件包装 / forEach
export { fc, forEach } from './fc.js'
export type { ForEachConfig } from './fc.js'

// canvas 组件（mve-dom-helper/canvasRender 薄桥接）+ 布局/颜色工具
export {
  canvas,
  canvasDraw,
  canvasStage,
  align,
  colorToCSS,
  flex,
  grow,
  ignoreFlex,
  layoutSize,
  layoutSizeDirection,
  rgba,
} from './canvas.js'
export type { CanvasComponent, CanvasTagFactory } from './canvas.js'

// 桥接共享工具：读值（lambda 展开）
export { readValue } from './args.js'

// three 组件（mve-three / three.js 薄桥接）
export { three, threeStage } from './three.js'
export type { ThreeComponent, ThreeTagFactory } from './three.js'

// 响应式信号 + language 原生原语：OOC 侧直接 import 使用，不需要 globals 注入
export { createSignal, memo, addEffect } from 'wy-helper'
export { createContext } from 'mve-core'
export { storage, js, merge } from 'object-oriented-c-language'

// {get,set} 持有者 → 无参读 / 单参写的 lambda；bindSignal/bindRef 是常用封装
export { bindSignal, bindRef, multiBind } from './multi-bind.js'
export type { Bound, Holder } from './multi-bind.js'

// portal 弹层 + 浮层定位（Dropdown / Select / Dialog / Sheet 用）
export { createPop, renderPop } from './pop.js'
export type { PopProvide } from './pop.js'
export { floating } from './floating.js'
export type { FloatingProps } from './floating.js'

// mve-icons 桥接
export {
  createIcon,
  iconCheck,
  iconChevronDown,
  iconX,
  provideIconContext,
} from './icons.js'
export type { IconProps } from './icons.js'

// 响应式订阅（Dialog/Sheet 跟随外部 open 信号）
export { hookTrackSignal } from 'mve-helper'

// hash 路由（example 用；页面仍是普通 OOC 组件）
export { routerProvide, routerConsume, fLink } from 'mve-dom-helper/history'

// 主题切换（跟随 <html class="dark">，localStorage 持久化）
export { dark, toggleTheme } from './theme.js'

// 桥接类型源与 loader（供 OOC 类型检查器解析全局类型，Route A）
export { createBridgeGlobalsTypes, bridgeTypesSource } from './types.js'

// 解释器路径的宿主对象集合（interpret/playground 笔记本用；codegen 走普通 import）
export { createBridgeGlobals } from './globals.js'