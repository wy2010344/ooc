/** OOC 常用符号 + Tab 的快捷条：聚焦代码区时浮在键盘上方 */
const SYMBOLS = [
  '(',
  ')',
  '{',
  '}',
  '[',
  ']',
  ';',
  '#',
  "'",
  '"',
  '//',
  ':',
  '|>',
  '-',
  '>',
  '<',
  '*',
  '/',
  '+',
  '%',
  '.',
  ' ',
]

interface Props {
  onInsert: (text: string) => void
}

export function QuickKeysBar({ onInsert }: Props) {
  return (
    <div className="shrink-0 border-t border-stone-200/70 bg-stone-100/95 px-2 py-1.5 backdrop-blur dark:border-zinc-800/70 dark:bg-zinc-950/95">
      <div className="flex gap-1.5 overflow-x-auto">
        <KeyBtn label="Tab" text="    " onInsert={onInsert} highlight />
        {SYMBOLS.map((s) => (
          <KeyBtn key={s} label={s} text={s === "'" || s === '"' ? s : s} onInsert={onInsert} />
        ))}
      </div>
    </div>
  )
}

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