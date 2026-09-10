/** OOC 常用符号 + Tab 的快捷条：聚焦代码区时钉在虚拟键盘正上方。
 *  符号集对齐 object-oriented-c.langium 里的真实 token：
 *  赋值 =、绑定 =>/->/<=、消息链 | 与除法替代 |>、比较 > < >= <= == != && ||、
 *  字符串 ' "、导入 #、注释 //、泛型 < >、其余定界符与四则。 */
const BAR_H = 52

const SYMBOLS = [
  '(',
  ')',
  '{',
  '}',
  '[',
  ']',
  ';',
  ',',
  '=',
  '=>',
  '->',
  '<=',
  '|',
  '|>',
  '<',
  '>',
  '>=',
  '==',
  '!=',
  '&&',
  '||',
  "+",
  '-',
  '*',
  '/',
  '%',
  '#',
  "'",
  '"',
  '//',
  '...',
  ':',
]

interface Props {
  onInsert: (text: string) => void
  /** 视觉视口底缘（visualViewport.offsetTop + height）对应的 top */
  top: number
}

export function QuickKeysBar({ onInsert, top }: Props) {
  return (
    <div
      style={{ top }}
      className="fixed left-1/2 z-40 w-full max-w-xl -translate-x-1/2"
    >
      <div className="flex h-[52px] items-center overflow-hidden border-t border-stone-200/70 bg-stone-100/95 backdrop-blur dark:border-zinc-800/70 dark:bg-zinc-950/95">
        <div className="flex h-full items-center gap-1.5 overflow-x-auto px-2">
          <KeyBtn label="Tab" text="    " onInsert={onInsert} highlight />
          {SYMBOLS.map((s) => (
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
  highlight,
}: {
  label: string
  text: string
  onInsert: (s: string) => void
  highlight?: boolean
}) {
  return (
    <button
      // preventDefault 保持 textarea 焦点，键盘不收起
      onPointerDown={(e) => e.preventDefault()}
      onClick={() => onInsert(text)}
      className={`shrink-0 rounded-lg px-3 py-2 font-mono text-[15px] leading-none transition-colors active:scale-95 ${
        highlight
          ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300'
          : 'bg-stone-200/90 text-stone-700 dark:bg-zinc-800 dark:text-zinc-200'
      }`}
    >
      {label}
    </button>
  )
}