// OOC 侧统一从这里 import 宿主依赖（视图组件 / 响应式信号 / language 原生原语）。
// 就是普通 TS re-export：codegen 产物里它们是普通 ES import，没有任何全局注入。
export { dom, text, html, fc, forEach } from 'ooc-mve-bridge'
export {
  createSignal,
  memo,
  addEffect,
  createContext,
  multiBind,
} from 'ooc-mve-bridge'
export {
  canvas,
  canvasDraw,
  three,
  readValue,
  flex,
  grow,
  align,
  ignoreFlex,
  rgba,
  colorToCSS,
  layoutSize,
  layoutSizeDirection,
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
