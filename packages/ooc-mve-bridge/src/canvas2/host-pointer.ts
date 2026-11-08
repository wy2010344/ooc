// canvas2 的指针宿主能力：画布坐标换算、全局鼠标注册、拖拽会话、剪贴板。
// 规则层（节点消息）只拿画布坐标，不碰 DOM 事件对象。

let canvasEl: HTMLCanvasElement | null = null

/** 舞台创建 canvas 时登记：之后全局鼠标 / 拖拽都按它换算画布坐标 */
export function setHostCanvas(el: HTMLCanvasElement) {
  canvasEl = el
}

function canvasPointOf(event: MouseEvent): { x: number; y: number } {
  if (!canvasEl) return { x: event.clientX, y: event.clientY }
  const rect = canvasEl.getBoundingClientRect()
  return { x: event.clientX - rect.left, y: event.clientY - rect.top }
}

/** 画布在视口中的位置（给输入层的 fixed 定位换算） */
export function canvasOrigin(): { left: number; top: number } {
  if (!canvasEl) return { left: 0, top: 0 }
  const rect = canvasEl.getBoundingClientRect()
  return { left: rect.left, top: rect.top }
}

/** 监听全局鼠标移动（canvas 坐标）；返回注销函数 */
export function addGlobalMove(fn: (x: number, y: number) => void): () => void {
  const handler = (event: MouseEvent) => {
    const p = canvasPointOf(event)
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
}

/** 拖拽会话：指针移出 canvas 也继续；松手自动摘除监听 */
export function dragPointer({ onMove, onEnd }: DragInput): () => void {
  const move = (event: MouseEvent) => {
    const p = canvasPointOf(event)
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
