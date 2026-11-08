// OOC 侧统一从这里 import 宿主依赖（视图组件 / 响应式信号 / language 原生原语）。
// 就是普通 TS re-export：codegen 产物里它们是普通 ES import，没有任何全局注入。
export { dom, text, html, fc, forEach, svg } from 'ooc-mve-bridge'
export {
  createSignal,
  lateProxy,
  memo,
  addEffect,
  createContext,
  bindSignal,
  bindRef,
  multiBind,
} from 'ooc-mve-bridge'
export {
  canvas,
  canvasDraw,
  three,
  readValue,
  flex,
  flex2,
  grow,
  grow2,
  align,
  align2,
  ignoreFlex,
  rgba,
  colorToCSS,
  layoutSize,
  layoutSizeDirection,
  createScroll2,
  forEachNode2,
  ifNode2,
  textDefaults2,
} from 'ooc-mve-bridge'
export { storage, js, merge } from 'object-oriented-c-language'
export {
  renderPop,
  createPop,
  floating,
  hookTrackSignal,
  iconCheck,
  iconChevronDown,
  iconX,
  provideIconContext,
} from 'ooc-mve-bridge'
export { dark, toggleTheme } from 'ooc-mve-bridge'
