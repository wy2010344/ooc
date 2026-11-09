// canvas2 的指针宿主能力：画布坐标换算、全局鼠标注册、拖拽会话、剪贴板。
// 规则层（节点消息）只拿画布坐标，不碰 DOM 事件对象。
//
// 多舞台：画布按「注册表 + 最近交互画布」管理，不能只留一个全局 canvasEl
// （第二个舞台创建时会把第一个的坐标基准悄悄换掉）。

const canvasEls: HTMLCanvasElement[] = []
let lastCanvas: HTMLCanvasElement | null = null

/** 舞台创建 canvas 时登记；之后全局鼠标 / 拖拽按「事件所在画布」或最近交互画布换算 */
export function setHostCanvas(el: HTMLCanvasElement) {
  if (!canvasEls.includes(el)) canvasEls.push(el)
  lastCanvas = el
}

/** 舞台收到交互时登记：本画布成为画布外松手 / textarea 定位的换算基准 */
export function setActiveCanvas(el: HTMLCanvasElement) {
  lastCanvas = el
}

/** 舞台销毁时摘掉自己，避免已移除的画布继续参与坐标换算 */
export function removeHostCanvas(el: HTMLCanvasElement) {
  const i = canvasEls.indexOf(el)
  if (i >= 0) canvasEls.splice(i, 1)
  if (lastCanvas === el) lastCanvas = canvasEls[canvasEls.length - 1] ?? null
}

/** 鼠标落在哪块画布上就用哪块换算；落在画布外（拖拽松手）时用最近交互的那块 */
function canvasOfEvent(event: MouseEvent): HTMLCanvasElement | null {
  for (let i = canvasEls.length - 1; i >= 0; i--) {
    const rect = canvasEls[i].getBoundingClientRect()
    if (
      event.clientX >= rect.left &&
      event.clientX <= rect.right &&
      event.clientY >= rect.top &&
      event.clientY <= rect.bottom
    ) {
      return canvasEls[i]
    }
  }
  return lastCanvas
}

/** fixed 非空时强制按该画布换算（跨画布拖动也不会串坐标） */
function canvasPointOf(
  event: MouseEvent,
  fixed?: HTMLCanvasElement | null,
): { x: number; y: number } {
  const canvas = fixed ?? canvasOfEvent(event)
  if (!canvas) return { x: event.clientX, y: event.clientY }
  const rect = canvas.getBoundingClientRect()
  return { x: event.clientX - rect.left, y: event.clientY - rect.top }
}

/** 画布在视口中的位置（给输入层的 fixed 定位换算） */
export function canvasOrigin(): { left: number; top: number } {
  const canvas = lastCanvas ?? canvasEls[0] ?? null
  if (!canvas) return { left: 0, top: 0 }
  const rect = canvas.getBoundingClientRect()
  return { left: rect.left, top: rect.top }
}

/** 监听全局鼠标移动（canvas 坐标）；返回注销函数 */
export function addGlobalMove(
  fn: (x: number, y: number) => void,
  canvas?: HTMLCanvasElement | null,
): () => void {
  const handler = (event: MouseEvent) => {
    const p = canvasPointOf(event, canvas)
    fn(p.x, p.y)
  }
  window.addEventListener('mousemove', handler)
  return () => window.removeEventListener('mousemove', handler)
}

/** 监听全局鼠标抬起（拖拽在画布外松手也能收到）；返回注销函数 */
export function addGlobalUp(fn: () => void): () => void {
  const handler = () => fn()
  window.addEventListener('mouseup', handler)
  return () => window.removeEventListener('mouseup', handler)
}

interface DragInput {
  /** 每次移动回调（canvas 坐标） */
  onMove: (x: number, y: number) => void
  /** 松开回调（可选） */
  onEnd?: () => void
  /** 固定换算画布（可选） */
  canvas?: HTMLCanvasElement | null
}

/** 拖拽会话：指针移出 canvas 也继续；松手自动摘除监听 */
export function dragPointer({ onMove, onEnd, canvas }: DragInput): () => void {
  const move = (event: MouseEvent) => {
    const p = canvasPointOf(event, canvas)
    onMove(p.x, p.y)
  }
  const up = () => {
    stop()
    if (onEnd) onEnd()
  }
  const stop = () => {
    window.removeEventListener('mousemove', move)
    window.removeEventListener('mouseup', up)
  }
  window.addEventListener('mousemove', move)
  window.addEventListener('mouseup', up)
  return stop
}

/** 写入系统剪贴板（失败静默：无权限 / 非安全上下文） */
export function clipboardWrite(text: string) {
  if (!text) return
  navigator.clipboard?.writeText(text).catch(() => undefined)
}

/** 读取系统剪贴板（异步回调；失败时给空串） */
export function clipboardRead({ onText }: { onText: (text: string) => void }) {
  const promise = navigator.clipboard?.readText()
  if (!promise) {
    onText('')
    return
  }
  promise.then(t => onText(t ?? '')).catch(() => onText(''))
}
