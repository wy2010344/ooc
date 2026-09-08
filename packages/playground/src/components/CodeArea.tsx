import { useMemo, useRef } from 'react'
import { renderTokens, tokenize } from '../lib/highlight.js'

interface Props {
  value: string
  onChange: (v: string) => void
  placeholder?: string
}

/** 记事本式代码区：透明 textarea 覆盖在高亮层上，输入时看到彩色、光标在真文本 */
export function CodeArea({ value, onChange, placeholder }: Props) {
  const taRef = useRef<HTMLTextAreaElement>(null)

  const html = useMemo(() => {
    const tokens = tokenize(value)
    return renderTokens(value, tokens)
  }, [value])

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
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        autoComplete="off"
        placeholder={placeholder}
        className="absolute inset-0 h-full w-full resize-none bg-transparent p-4 font-mono text-[15px] leading-6 text-transparent caret-emerald-600 outline-none dark:caret-emerald-500"
      />
    </div>
  )
}

function escapePlaceholder(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}