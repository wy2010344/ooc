// 画布里的文本输入承接层：一个隐藏 textarea 负责键盘 / IME / 粘贴，
// 事件按「消息」转给当前编辑节点（handle），宿主不读 OOC 的内部状态。
// handle 契约（OOC 侧实现）：focus / blur / handleKey / copySel / cutSel /
// pasteText / onComposing / commitComposingText / endComposition / inputOverlay。
//
// 多舞台：textarea 全局只有一个（浏览器焦点本来就唯一），但归属按舞台引用计数，
// 且当前活跃编辑器绑定自己的画布——销毁其中一块画布不会拆掉另一块的输入层。

import { canvasOrigin, clipboardRead, clipboardWrite } from './host-pointer.js'

interface EditorHandle {
  focus(): void
  blur(): void
  handleKey(event: KeyEventInput): boolean
  copySel(): string | null
  cutSel(): string | null
  pasteText(text: string): void
  onComposing(text: string, cursor: number): void
  commitComposingText(text: string): void
  /** restore=true 时把预编辑窗口文本回退到组合开始前（Esc 取消组合） */
  endComposition(restore: boolean): void
  inputOverlay(): { x: number; y: number; w: number; h: number; fontSize: number } | null
}

interface KeyEventInput {
  key: string
  ctrl: boolean
  shift: boolean
  alt: boolean
  meta: boolean
}

let input: HTMLTextAreaElement | null = null
let active: EditorHandle | null = null
let activeCanvas: HTMLCanvasElement | null = null
let composing = false
/** Esc 取消组合后置位：随后到达的 compositionend 不能再把窗口串提交一次 */
let composeCancelled = false
/** 已登记的舞台数；只有最后一个销毁时才移除 textarea */
let owners = 0

/** 舞台创建时登记（与 disposeTextInput 成对） */
export function registerTextInput() {
  owners++
}

function originOf(): { left: number; top: number } {
  if (activeCanvas) {
    const rect = activeCanvas.getBoundingClientRect()
    return { left: rect.left, top: rect.top }
  }
  return canvasOrigin()
}

function ensureInput(): HTMLTextAreaElement {
  if (input) return input
  const ta = document.createElement('textarea')
  ta.setAttribute('autocomplete', 'off')
  ta.setAttribute('autocapitalize', 'off')
  ta.setAttribute('spellcheck', 'false')
  ta.style.cssText = [
    'position:fixed',
    'left:0',
    'top:0',
    'width:1px',
    'height:1px',
    'padding:0',
    'border:0',
    'margin:0',
    'resize:none',
    'overflow:hidden',
    'opacity:0',
    'background:transparent',
    'color:transparent',
    'caret-color:transparent',
    'outline:none',
    'pointer-events:none',
    'z-index:9999',
  ].join(';')
  ta.addEventListener('keydown', onKeyDown)
  ta.addEventListener('focus', () => active?.focus())
  ta.addEventListener('blur', () => active?.blur())
  ta.addEventListener('compositionstart', () => {
    composing = true
    composeCancelled = false
    ta.value = ''
  })
  ta.addEventListener('compositionupdate', event => {
    if (!active || composeCancelled) return
    active.onComposing(ta.value || event.data || '', ta.selectionStart ?? 0)
  })
  ta.addEventListener('compositionend', event => {
    const cancelled = composeCancelled
    composing = false
    composeCancelled = false
    const text = event.data ?? ta.value
    ta.value = ''
    if (!active || cancelled) return
    active.commitComposingText(text ?? '')
  })
  ta.addEventListener('paste', event => {
    if (!active) return
    const text = event.clipboardData?.getData('text/plain') ?? ''
    event.preventDefault()
    active.pasteText(text)
  })
  ta.addEventListener('input', () => {
    if (!composing) ta.value = ''
  })
  document.body.appendChild(ta)
  input = ta
  return ta
}

function onKeyDown(event: KeyboardEvent) {
  if (!active) return
  // 组合态下 Esc 归输入法 / 编辑器：窗口文本必须回退，不能留在正文里
  if (event.key === 'Escape' && composing) {
    composeCancelled = true
    composing = false
    if (input) input.value = ''
    event.preventDefault()
    active.endComposition(true)
    return
  }
  const mod = event.ctrlKey || event.metaKey
  const key = event.key.toLowerCase()
  if (mod && (key === 'c' || key === 'x')) {
    const text = key === 'c' ? active.copySel() : active.cutSel()
    if (text) clipboardWrite(text)
    event.preventDefault()
    return
  }
  if (mod && key === 'v') {
    event.preventDefault()
    clipboardRead({ onText: text => active?.pasteText(text ?? '') })
    return
  }
  const consumed = active.handleKey({
    key: event.key,
    ctrl: event.ctrlKey,
    shift: event.shiftKey,
    alt: event.altKey,
    meta: event.metaKey,
  })
  if (consumed) {
    event.preventDefault()
    syncInputPosition()
  }
}

/** 让隐藏 textarea 贴住当前光标（IME 候选窗 / 粘贴落点都靠它） */
export function syncInputPosition() {
  if (!input || !active) return
  const box = active.inputOverlay()
  if (!box) {
    input.style.left = '0px'
    input.style.top = '0px'
    input.style.width = '1px'
    input.style.height = '1px'
    return
  }
  const origin = originOf()
  input.style.left = `${origin.left + box.x}px`
  input.style.top = `${origin.top + box.y}px`
  input.style.width = `${Math.max(1, box.w)}px`
  input.style.height = `${Math.max(1, box.h)}px`
  input.style.fontSize = `${box.fontSize}px`
}

/**
 * 舞台把「命中的编辑节点」交给这里：固定其中一个 handle。
 * nil 表示点到非编辑区，摘掉焦点。canvas 用于输入层定位（多画布时不可省略）。
 */
export function setActiveEditor(
  handle: EditorHandle | null,
  canvas?: HTMLCanvasElement | null,
) {
  if (canvas) activeCanvas = canvas
  if (!handle) {
    if (active) active.blur()
    active = null
    input?.blur()
    return
  }
  if (active !== handle) {
    active?.blur()
  }
  active = handle
  // 先让编辑器进入聚焦态（光标闪烁 / 输入层定位），再聚焦隐藏 textarea
  handle.focus()
  const ta = ensureInput()
  syncInputPosition()
  // 已经聚焦也补一次：从工具栏点回来时焦点会丢
  ta.focus({ preventScroll: true })
}

/**
 * 舞台销毁：只减自己的引用。仍指向本画布的活跃编辑器一并摘掉；
 * 不调 blur：销毁期写信号会撞 didSet 保护。其它舞台的输入层保持可用。
 */
export function disposeTextInput(canvas?: HTMLCanvasElement | null) {
  owners = Math.max(0, owners - 1)
  if (canvas && activeCanvas === canvas) {
    active = null
    composing = false
    composeCancelled = false
    input?.blur()
  }
  if (owners === 0) {
    active = null
    composing = false
    composeCancelled = false
    activeCanvas = null
    input?.remove()
    input = null
  }
}
