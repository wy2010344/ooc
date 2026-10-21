import { createSignal } from 'wy-helper'

const THEME_KEY = 'ooc-theme'

/** 读取初始主题：优先 localStorage，其次系统偏好。 */
function readInitialDark(): boolean {
  if (typeof window === 'undefined') return false
  try {
    const saved = window.localStorage.getItem(THEME_KEY)
    if (saved) return saved === 'dark'
  } catch {
    // 隐私模式等场景下 localStorage 不可用，退回系统偏好
  }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false
}

const darkSignal = createSignal(readInitialDark())

/** 把主题同步到 <html class="dark">。 */
function applyTheme(value: boolean) {
  if (typeof document === 'undefined') return
  document.documentElement.classList.toggle('dark', value)
}

// 模块加载即同步首屏主题，避免刷新后闪回浅色
applyTheme(darkSignal.get())

/** OOC 侧无参读：`dark $`，读取时会订阅信号。 */
export function dark(): boolean {
  return darkSignal.get()
}

/** 切换并持久化主题，返回切换后的值。 */
export function toggleTheme(): boolean {
  const next = !darkSignal.get()
  darkSignal.set(next)
  applyTheme(next)
  try {
    window.localStorage.setItem(THEME_KEY, next ? 'dark' : 'light')
  } catch {
    // 忽略存储失败，主题在当前会话内仍然生效
  }
  return next
}
