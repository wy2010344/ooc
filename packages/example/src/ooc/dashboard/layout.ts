// 看板布局辅助：拖拽分隔条 + 本地持久化 + 数值夹取。
// 拖拽使用 Pointer Events，松手后自动移除 window 监听，不依赖 React/框架生命周期。

export type DragAxis = 'x' | 'y'

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function clampSize(value: number, min: number, max: number): number {
  return clamp(value, min, max)
}

/**
 * 开始拖动分隔条。
 * start 是拖动前的尺寸，sign 控制方向：右侧面板取 -1（鼠标右移 = 面板变窄）。
 */
export function dragSplit(
  event: PointerEvent,
  axis: DragAxis,
  start: number,
  sign: number,
  min: number,
  max: number,
  onChange: (value: number) => void,
  onEnd?: () => void,
): void {
  event.preventDefault()
  const startX = event.clientX
  const startY = event.clientY
  const previousCursor = document.body.style.cursor
  const previousSelect = document.body.style.userSelect

  const move = (next: PointerEvent) => {
    const delta = axis === 'x' ? next.clientX - startX : next.clientY - startY
    onChange(clamp(start + delta * sign, min, max))
  }
  const end = () => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', end)
    window.removeEventListener('pointercancel', end)
    document.body.style.cursor = previousCursor
    document.body.style.userSelect = previousSelect
    onEnd?.()
  }

  document.body.style.cursor = axis === 'x' ? 'col-resize' : 'row-resize'
  document.body.style.userSelect = 'none'
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', end)
  window.addEventListener('pointercancel', end)
}

export type LayoutState = {
  leftWidth: number
  rightWidth: number
  leftBottom: number
  centerBottom: number
  rightBottom: number
}

const LAYOUT_KEY = 'ooc-finance-layout-v1'
const DEFAULT_LAYOUT: LayoutState = {
  leftWidth: 248,
  rightWidth: 316,
  leftBottom: 224,
  centerBottom: 218,
  rightBottom: 226,
}

export function loadLayout(): LayoutState {
  try {
    const raw = localStorage.getItem(LAYOUT_KEY)
    if (!raw) return { ...DEFAULT_LAYOUT }
    const parsed = JSON.parse(raw) as Partial<LayoutState>
    return {
      leftWidth: clampSize(Number(parsed.leftWidth) || DEFAULT_LAYOUT.leftWidth, 176, 420),
      rightWidth: clampSize(Number(parsed.rightWidth) || DEFAULT_LAYOUT.rightWidth, 224, 520),
      leftBottom: clampSize(Number(parsed.leftBottom) || DEFAULT_LAYOUT.leftBottom, 120, 420),
      centerBottom: clampSize(
        Number(parsed.centerBottom) || DEFAULT_LAYOUT.centerBottom,
        120,
        420,
      ),
      rightBottom: clampSize(
        Number(parsed.rightBottom) || DEFAULT_LAYOUT.rightBottom,
        120,
        420,
      ),
    }
  } catch {
    return { ...DEFAULT_LAYOUT }
  }
}

export function saveLayout(layout: LayoutState): void {
  try {
    localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout))
  } catch {
    // 隐私模式/存储禁用时静默降级
  }
}

export function resetLayout(): LayoutState {
  try {
    localStorage.removeItem(LAYOUT_KEY)
  } catch {
    // ignore
  }
  return { ...DEFAULT_LAYOUT }
}
