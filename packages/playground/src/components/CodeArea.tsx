import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
} from 'react'
import { renderTokens, tokenize } from '../lib/highlight.js'

interface Props {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  /** 聚焦状态变化（用于在移动键盘上方显示快捷键） */
  onFocusChange?: (focused: boolean) => void
}

export interface CodeAreaHandle {
  /** 在光标处插入文本（移动端快捷键用），替换选中区域 */
  insert: (text: string) => void
  focus: () => void
}

/** 记事本式代码区：透明 textarea 覆盖在高亮层上，输入时看到彩色、光标在真文本 */
export const CodeArea = forwardRef<CodeAreaHandle, Props>(function CodeArea(
  { value, onChange, placeholder, onFocusChange },
  ref,
) {
  const taRef = useRef<HTMLTextAreaElement>(null)
  // 受控组件重建 value 后要恢复的光标位置
  const pendingCaret = useRef<number | null>(null)

  const html = useMemo(() => {
    const tokens = tokenize(value)
    return renderTokens(value, tokens)
  }, [value])

  const insert = useCallback(
    (text: string) => {
      const el = taRef.current
      if (!el) return
      el.focus()
      const { selectionStart, selectionEnd } = el
      if (selectionStart == null || selectionEnd == null) return
      const next = value.slice(0, selectionStart) + text + value.slice(selectionEnd)
      pendingCaret.current = selectionStart + text.length
      onChange(next)
    },
    [value, onChange],
  )

  // value 换新后把光标放回插入点末尾
  useEffect(() => {
    const el = taRef.current
    if (el && pendingCaret.current != null) {
      el.setSelectionRange(pendingCaret.current, pendingCaret.current)
      pendingCaret.current = null
    }
  }, [value])

  useImperativeHandle(ref, () => ({ insert, focus: () => taRef.current?.focus() }), [insert])

  // 移动端按下时聚焦，弹起键盘
  const focusOnTouch = () => taRef.current?.focus()

  return (
    <div
      className="relative h-full w-full overflow-hidden"
      onPointerDown={focusOnTouch}
    >
      {/* 高亮层（只显示，不拦截触摸） */}
      <pre
        aria-hidden
        className="pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap break-words p-4 font-mono text-[15px] leading-6 text-stone-900 dark:text-zinc-100"
        dangerouslySetInnerHTML={{
          __html: html || `<span class="text-stone-400 dark:text-zinc-600">${escapePlaceholder(placeholder ?? '')}</span>`,
        }}
      />
      {/* 输入层：透明文字，光标真实 */}
      <textarea
        ref={taRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => onFocusChange?.(true)}
        onBlur={() => onFocusChange?.(false)}
        onKeyDown={(e) => {
          // 物理键盘 Tab：插入缩进而非切换焦点
          if (e.key === 'Tab') {
            e.preventDefault()
            insert('    ')
          }
        }}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        autoComplete="off"
        placeholder={placeholder}
        className="absolute inset-0 h-full w-full resize-none bg-transparent p-4 font-mono text-[15px] leading-6 text-transparent caret-emerald-600 outline-none dark:caret-emerald-500"
      />
    </div>
  )
})

function escapePlaceholder(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}