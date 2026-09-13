/** OOC 常用符号 + Tab 的快捷条：聚焦代码区时钉在虚拟键盘正上方，两排。
 *  上排是 ⇧ 开关 / Tab / 成对键——括号、单引号、块注释都成对出现，点一下成对插入
 *  并把光标停在中间；下排是单字符原子键，组合 token 用连按拼（=,> 得 =>；<,= 得 <=；
 *  &,& 得 &&；/,/ 得 // 注释）。
 *  ⇧ 开关：开启后 Tab 走 ⇧+Tab（反向缩进）——移动端没有硬件 Shift 也能做。
 *  键无分组分隔，直接平铺；'|' '/' 最常用放最前。 */
import { useState } from 'react'

const BAR_H = 84

// 成对键：open+close 一次插入，光标落到中间
const PAIRS: { label: string; open: string; close: string }[] = [
  { label: '()', open: '(', close: ')' },
  { label: '[]', open: '[', close: ']' },
  { label: '{}', open: '{', close: '}' },
  { label: "''", open: "'", close: "'" },
  { label: '/**', open: '/*', close: '*/' },
]

// 原子键平铺顺序：'|' '/'（管道/级联）最常用排最前
const KEYS = ['|', '/', ';', ',', ':', '=', '<', '>', '+', '-', '*', '%', '"', '#', '.']

interface Props {
  onInsert: (text: string) => void
  onInsertPair: (open: string, close: string) => void
  onOutdent: () => void
  /** 视觉视口底缘（visualViewport.offsetTop + height）对应的 top */
  top: number
}

export function QuickKeysBar({ onInsert, onInsertPair, onOutdent, top }: Props) {
  const [shift, setShift] = useState(false)
  return (
    <div
      style={{ top }}
      className="fixed left-1/2 z-40 w-full max-w-xl -translate-x-1/2"
    >
      <div className="flex h-[84px] flex-col overflow-hidden border-t border-stone-200/70 bg-stone-100/95 backdrop-blur dark:border-zinc-800/70 dark:bg-zinc-950/95">
        {/* 上排：⇧ / Tab / 成对键 */}
        <div className="flex h-[42px] items-center gap-1.5 overflow-x-auto px-2">
          <button
            onPointerDown={(e) => e.preventDefault()}
            onClick={() => setShift((s) => !s)}
            aria-pressed={shift}
            className={`shrink-0 whitespace-nowrap rounded-lg px-3 py-1.5 text-[15px] font-semibold leading-none transition-colors active:scale-95 ${
              shift
                ? 'bg-emerald-600 text-white'
                : 'bg-stone-200/90 text-stone-600 dark:bg-zinc-800 dark:text-zinc-300'
            }`}
          >
            {shift ? '⇧开' : '⇧'}
          </button>

          <button
            onPointerDown={(e) => e.preventDefault()}
            onClick={() => (shift ? onOutdent() : onInsert('    '))}
            className={`shrink-0 whitespace-nowrap rounded-lg px-3 py-1.5 font-mono text-[14px] leading-none transition-colors active:scale-95 ${
              shift
                ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300'
                : 'bg-stone-200/90 text-stone-700 dark:bg-zinc-800 dark:text-zinc-200'
            }`}
          >
            {shift ? '⇧+Tab' : 'Tab'}
          </button>

          {PAIRS.map((pair) => (
            <button
              key={pair.label}
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => onInsertPair(pair.open, pair.close)}
              className="shrink-0 whitespace-nowrap rounded-lg bg-stone-200/90 px-3 py-1.5 font-mono text-[14px] leading-none text-stone-700 transition-colors active:scale-95 dark:bg-zinc-800 dark:text-zinc-200"
            >
              {pair.label}
            </button>
          ))}
        </div>

        {/* 下排：原子键平铺，'|' '/' 最常用在最前 */}
        <div className="flex h-[42px] items-center gap-1.5 overflow-x-auto border-t border-stone-200/50 px-2 dark:border-zinc-800/50">
          {KEYS.map((s) => (
            <KeyBtn key={s} label={s} text={s} onInsert={onInsert} />
          ))}
        </div>
      </div>
    </div>
  )
}

export const QUICK_KEYS_BAR_H = BAR_H

function KeyBtn({
  label,
  text,
  onInsert,
}: {
  label: string
  text: string
  onInsert: (s: string) => void
}) {
  return (
    <button
      // preventDefault 保持 textarea 焦点，键盘不收起
      onPointerDown={(e) => e.preventDefault()}
      onClick={() => onInsert(text)}
      className="shrink-0 whitespace-nowrap rounded-lg bg-stone-200/90 px-3 py-1.5 font-mono text-[14px] leading-none text-stone-700 transition-colors active:scale-95 dark:bg-zinc-800 dark:text-zinc-200"
    >
      {label}
    </button>
  )
}