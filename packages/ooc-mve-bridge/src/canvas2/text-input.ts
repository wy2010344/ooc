// 画布里的文本输入承接层：一个隐藏 textarea 负责键盘 / IME / 粘贴，
// 事件按「消息」转给当前编辑节点（handle），宿主不读 OOC 的内部状态。
// handle 契约（OOC 侧实现）：focus / blur / handleKey / copySel / cutSel /
// pasteText / onComposing / commitComposingText / inputOverlay。

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
let composing = false

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
    ta.value = ''
  })
  ta.addEventListener('compositionupdate', event => {
    if (!active) return
    active.onComposing(ta.value || event.data || '', ta.selectionStart ?? 0)
  })
  ta.addEventListener('compositionend', event => {
    composing = false
    const text = event.data ?? ta.value
    ta.value = ''
    if (!active) return
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
  const origin = canvasOrigin()
  input.style.left = `${origin.left + box.x}px`
  input.style.top = `${origin.top + box.y}px`
  input.style.width = `${Math.max(1, box.w)}px`
  input.style.height = `${Math.max(1, box.h)}px`
  input.style.fontSize = `${box.fontSize}px`
}

/**
 * 舞台把「命中的编辑节点」交给这里：固定其中一个 handle。
 * nil 表示点到非编辑区，摘掉焦点。
 */
export function setActiveEditor(handle: EditorHandle | null) {
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

/** 舞台销毁：摘掉全局输入层（页面切走时调用）。不调 blur：销毁期写信号会撞保护 */
export function disposeTextInput() {
  active = null
  input?.remove()
  input = null
}
