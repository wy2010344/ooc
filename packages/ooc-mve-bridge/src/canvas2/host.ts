// canvas2 的宿主薄层：只汇总「TS 侧可复用能力」与 OOC 内建（merge / storage / fc）。
// 约定（见 canvasRender2/PORTING.md §1）：OOC 侧只按契约名发消息，缺省由 merge 兜底；
// 这里不提供任何「探测对象有没有某个成员」的工具。

export { merge, storage } from 'object-oriented-c-language'
export { fc } from '../fc.js'

export { memo, collectSignal, absoluteLayoutFun, createSignal } from 'wy-helper'
export { renderRoot } from 'mve-core'
export { renderFDom } from 'mve-dom'
export {
  syncCanvasSize,
  colorToCSS,
  roundRectPath,
} from 'mve-dom-helper/canvasRender'
export {
  createLayout,
  defaultSize,
  defaultPosition,
  hitPath,
  dispatchMousePath,
  buildChildren,
  flex,
  grow as grow2,
  absoluteX,
  absoluteY,
  repeatEvery,
  textDefaults as coreTextDefaults,
} from 'mve-dom-helper/canvasRender2'
export {
  applyTextStyle,
  measureTextWidth,
  measureTextInk,
  wrapText,
} from './text-measure.js'
export {
  buildRichParagraph,
  paraWidth,
  paraHeight,
  paraLineCount,
  paraRects,
  paraCaretRect,
  paraLineIndexOf,
  paraGlyphAt,
  paraOffsetOnLine,
  paraLineEdge,
  drawRichParagraph,
} from './rich-paragraph.js'
export {
  setHostCanvas,
  setActiveCanvas,
  removeHostCanvas,
  addGlobalMove,
  addGlobalUp,
  dragPointer,
  clipboardWrite,
  clipboardRead,
  canvasOrigin,
} from './host-pointer.js'
export { wordRangeOf, paragraphRangeOf } from './selection.js'
export {
  setActiveEditor,
  syncInputPosition,
  registerTextInput,
  disposeTextInput,
} from './text-input.js'

// 同一文件内使用需要本地绑定（re-export 不引入作用域名）
import { colorToCSS, roundRectPath } from 'mve-dom-helper/canvasRender'
import { buildChildren } from 'mve-dom-helper/canvasRender2'

// ---------------------------------------------------------------------------
// 值级辅助：参数都是 TS 侧数据，不做成员探测
// ---------------------------------------------------------------------------

/** size 消息允许 number | { value, fromInside } 两种写法 */
export const isNum = (v: unknown): v is number => typeof v == 'number'

/** OOC 里 throw 需要宿主承载 */
export function fail(message: string): never {
  throw new Error(message)
}

/** 单调时钟（毫秒）：淡入淡出插值用 */
export function nowMs(): number {
  return performance.now()
}

/** 延时回调：返回取消函数（OOC 侧在销毁时调用） */
export function delay(ms: number, fn: () => void): () => void {
  const id = setTimeout(fn, ms)
  return () => clearTimeout(id)
}

/**
 * 每舞台独立的重绘调度。
 * wy-dom-helper 的 debounceRequestBatchAnimationFrame 是全局单槽：同一帧里
 * 第二个画布再请求会被直接丢弃且不会重试，多画布页面会有一块永远画不出来。
 * 这里直接走 rAF，由各舞台自己维护「是否已排队」，请求不会互相吞。
 */
export function requestFrame(fn: () => void): number {
  return requestAnimationFrame(fn)
}

export function cancelFrame(id: number): void {
  cancelAnimationFrame(id)
}

/** 读取 TS 对象字段（只用于宿主自己的对象，如 holder / syncCanvasSize 的返回值） */
export function propOf(o: any, key: string): any {
  return o[key]
}

/** 取 2D 上下文：拿不到就直接报错（宿主能力缺失，不是可恢复状态） */
export function context2Of(el: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx2 = el.getContext('2d')
  if (!ctx2) fail('当前浏览器不支持 Canvas 2D')
  return ctx2
}

/** 画布 DOM 属性：只取非 nil 的三项，交给 renderFDom */
export function canvasAttrsOf(id?: any, className?: any, style?: any) {
  const out: Record<string, unknown> = {}
  if (id != null) out.id = id
  if (className != null) out.className = className
  if (style != null) out.style = style
  return out
}

/** 指针派发入参（dispatchMousePath 的 init） */
function mouseInitOf(
  type: string,
  globalX: number,
  globalY: number,
  button: number,
  buttons: number,
  wheelDeltaX: number,
  wheelDeltaY: number,
) {
  return {
    type,
    globalX,
    globalY,
    device: 'mouse' as const,
    pointerId: 0,
    button,
    buttons,
    wheelDeltaX,
    wheelDeltaY,
  }
}

/**
 * DOM 鼠标编号 → 引擎编号（1=左 / 2=中 / 3=右，0=无）。
 * 翻译只发生在宿主适配器这一处，规则层只认引擎编号。
 */
function engineButtonOf(domButton: number): number {
  switch (domButton) {
    case 0:
      return 1
    case 1:
      return 2
    case 2:
      return 3
    default:
      return 0
  }
}

/** DOM buttons 位掩码 → 引擎位掩码（DOM: 1=左 2=右 4=中；引擎: 1=左 2=中 4=右） */
function engineButtonsOf(domButtons: number): number {
  let mask = 0
  if (domButtons & 1) mask |= 1
  if (domButtons & 4) mask |= 2
  if (domButtons & 2) mask |= 4
  return mask
}

/** DOM 鼠标事件 → dispatchMousePath 入参（坐标相对 canvas） */
export function pointerInitOf(type: string, event: any) {
  return mouseInitOf(
    type,
    event.offsetX,
    event.offsetY,
    engineButtonOf(event.button),
    engineButtonsOf(event.buttons),
    0,
    0,
  )
}

/** DOM WheelEvent → dispatchMousePath 入参（按 deltaMode 归一化增量） */
export function wheelInitOf(event: any) {
  let dx = event.deltaX
  let dy = event.deltaY
  if (event.deltaMode === 1) {
    dx *= 16
    dy *= 16
  } else if (event.deltaMode === 2) {
    const h = (event.currentTarget as HTMLElement | null)?.clientHeight ?? 800
    dx *= h
    dy *= h
  }
  return mouseInitOf(
    'wheel',
    event.offsetX,
    event.offsetY,
    engineButtonOf(event.button),
    engineButtonsOf(event.buttons),
    dx,
    dy,
  )
}

/**
 * 矩形节点的绘制（背景 + 边框 + 圆角）。
 *
 * 参数都是**已求值的数据**：OOC 侧先按消息读出 p 的成员再传进来，
 * 宿主不接触 OOC 的 merge 包装（那上面读属性拿到的是「可调用绑定」而不是值）。
 */
interface RectBoxInput {
  ctx2: CanvasRenderingContext2D
  w: number
  h: number
  bw: number
  bg: any
  bc: any
  r: number
}

export function drawRectBox({ ctx2, w, h, bw, bg, bc, r }: RectBoxInput) {
  if (w <= 0 || h <= 0) return
  const hasBorder = bc != null && bw > 0
  // 边框线宽居中：盒子外沿内缩 bw/2
  const x = hasBorder ? bw / 2 : 0
  const y = hasBorder ? bw / 2 : 0
  const boxW = hasBorder ? Math.max(0, w - bw) : w
  const boxH = hasBorder ? Math.max(0, h - bw) : h
  if (bg != null) {
    ctx2.fillStyle = colorToCSS(bg)
    if (r > 0) {
      roundRectPath(ctx2, x, y, boxW, boxH, r)
      ctx2.fill()
    } else {
      ctx2.fillRect(x, y, boxW, boxH)
    }
  }
  if (hasBorder) {
    ctx2.strokeStyle = colorToCSS(bc)
    ctx2.lineWidth = bw
    if (r > 0) {
      roundRectPath(ctx2, x, y, boxW, boxH, r)
      ctx2.stroke()
    } else {
      ctx2.strokeRect(x, y, boxW, boxH)
    }
  }
}

/** 子表达式展开回调：mve-core 以 callback 的 this 作为 holder */
export function childrenCallback(children: any) {
  return function (this: any) {
    buildChildren(this, children)
  }
}

/**
 * 展平嵌套 children 并按 `hide` 过滤（与 canvasCore/List.ts 的 flatten 同义）。
 * 只发 `hide` 消息，不读对象结构。
 */
export function flattenChildren(list: readonly any[], out: any[]) {
  for (const child of list) {
    if (typeof child == 'function') {
      flattenChildren((child as () => readonly any[])(), out)
    } else if (!(child as any).hide()) {
      out.push(child)
    }
  }
}
