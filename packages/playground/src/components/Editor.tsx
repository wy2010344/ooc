import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Menu,
  MenuButton,
  MenuItem,
  MenuItems,
} from '@headlessui/react'
import {
  ArrowLeft,
  ClockCounterClockwise,
  DotsThreeVertical,
  Play,
  Trash,
  Warning,
} from '@phosphor-icons/react'
import { Notebook } from '../hooks/useNotebook.js'
import { CodeArea, type CodeAreaHandle } from './CodeArea.js'
import { HistorySheet } from './HistorySheet.js'
import { QuickKeysBar } from './QuickKeysBar.js'
import type { RunResult } from '../lib/run.js'

interface Props {
  nb: Notebook
  note: { name: string; source: string }
}

export function Editor({ nb, note }: Props) {
  const [text, setText] = useState(note.source)
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<RunResult | null>(null)
  const [renaming, setRenaming] = useState(false)
  const [newName, setNewName] = useState('')
  const [renameErr, setRenameErr] = useState<string | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)
  const codeRef = useRef<CodeAreaHandle>(null)
  const [codeFocused, setCodeFocused] = useState(false)
  const saveTimer = useRef<number | null>(null)

  // 笔记切换时同步文本
  useEffect(() => {
    setText(note.source)
    setResult(null)
  }, [note.name])

  // 输入防抖自动保存
  const onChange = useCallback(
    (v: string) => {
      setText(v)
      if (saveTimer.current) window.clearTimeout(saveTimer.current)
      saveTimer.current = window.setTimeout(() => {
        void nb.saveNote(note.name, v)
      }, 600)
    },
    [nb, note.name],
  )

  useEffect(() => () => {
    if (saveTimer.current) window.clearTimeout(saveTimer.current)
  }, [])

  const run = useCallback(async () => {
    setRunning(true)
    setResult(null)
    try {
      const r = await nb.run(note.name, text)
      setResult(r)
    } finally {
      setRunning(false)
    }
  }, [nb, note.name, text])

  const doRename = useCallback(async () => {
    const raw = newName.trim()
    if (!raw) return
    // 省去手打扩展名：没写 .ooc 就自动补上
    const target = raw.toLowerCase().endsWith('.ooc') ? raw : `${raw}.ooc`
    // 重命名前清掉未落盘的防抖保存，避免旧名回写
    if (saveTimer.current) {
      window.clearTimeout(saveTimer.current)
      saveTimer.current = null
    }
    const ok = await nb.renameNote(note.name, target)
    if (ok) {
      setRenaming(false)
      setRenameErr(null)
    } else {
      setRenameErr('同名笔记已存在')
    }
  }, [nb, newName, note.name])

  // 进入重命名态：预填当前名（去掉后缀），便于就地改
  const enterRename = useCallback(() => {
    setNewName(note.name.replace(/\.ooc$/i, ''))
    setRenameErr(null)
    setRenaming(true)
  }, [note.name])

  const doDelete = useCallback(async () => {
    if (window.confirm(`删除 ${note.name}？`)) {
      nb.removeNote(note.name)
    }
  }, [nb, note.name])

  const hasDiagnostics = (result?.diagnostics.length ?? 0) > 0

  return (
    <div className="mx-auto flex h-dvh w-full max-w-xl flex-col overflow-hidden bg-stone-100 dark:bg-zinc-950">
      {/* 顶栏 */}
      <header className="sticky top-0 z-20 flex shrink-0 items-center gap-1 border-b border-stone-200/70 bg-stone-100/90 px-2 py-2 backdrop-blur dark:border-zinc-800/70 dark:bg-zinc-950/90">
        <button
          onClick={() => nb.setActive(null)}
          aria-label="返回列表"
          className="rounded-full p-2 text-stone-600 transition-colors active:bg-stone-200 dark:text-zinc-400 dark:active:bg-zinc-800"
        >
          <ArrowLeft size={20} />
        </button>

        {renaming ? (
          <>
            <div className="flex min-w-0 flex-1 items-center gap-1">
              <input
                value={newName}
                onChange={(e) => {
                  setNewName(e.target.value)
                  setRenameErr(null)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void doRename()
                }}
                autoCapitalize="off"
                autoCorrect="off"
                placeholder="笔记名"
                autoFocus
                className="min-w-0 flex-1 border-b border-emerald-600 bg-transparent py-0.5 font-mono text-sm text-stone-900 outline-none placeholder:text-stone-400 dark:text-zinc-100 dark:placeholder:text-zinc-600"
              />
              <button
                onClick={() => void doRename()}
                className="rounded-full px-2 py-1 text-sm font-medium text-emerald-700 dark:text-emerald-500"
              >
                确定
              </button>
            </div>
            {renameErr && (
              <p className="shrink-0 whitespace-nowrap text-xs text-rose-600 dark:text-rose-400">
                {renameErr}
              </p>
            )}
          </>
        ) : (
          <button
            onClick={() => (renaming ? setRenaming(false) : enterRename())}
            className="min-w-0 flex-1 truncate px-2 py-1 text-left font-mono text-sm font-medium text-stone-900 dark:text-zinc-100"
          >
            {note.name}
          </button>
        )}

        <button
          onClick={() => void run()}
          disabled={running}
          className={`ml-1 flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-medium text-white transition-transform active:scale-95 ${
            running ? 'bg-stone-400 dark:bg-zinc-600' : 'bg-emerald-700 dark:bg-emerald-600'
          }`}
        >
          <Play size={14} weight="fill" />
          {running ? '运行中' : '运行'}
        </button>

        <Menu>
          <MenuButton
            aria-label="更多"
            className="rounded-full p-2 text-stone-600 transition-colors active:bg-stone-200 dark:text-zinc-400 dark:active:bg-zinc-800"
          >
            <DotsThreeVertical size={20} />
          </MenuButton>
          <MenuItems
            anchor="bottom end"
            className="mt-1 w-44 origin-top-right overflow-hidden rounded-2xl border border-stone-200 bg-white p-1 shadow-lg dark:border-zinc-800 dark:bg-zinc-900"
          >
            <MenuItem>
              <button
                onClick={() => setHistoryOpen(true)}
                className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm text-stone-700 hover:bg-stone-100 dark:text-zinc-200 dark:hover:bg-zinc-800"
              >
                <ClockCounterClockwise size={15} />
                执行历史
              </button>
            </MenuItem>
            <MenuItem>
              <button
                onClick={enterRename}
                className="w-full rounded-xl px-3 py-2 text-left text-sm text-stone-700 hover:bg-stone-100 dark:text-zinc-200 dark:hover:bg-zinc-800"
              >
                重命名
              </button>
            </MenuItem>
            <MenuItem>
              <button
                onClick={() => void doDelete()}
                className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-950/40"
              >
                <Trash size={15} />
                删除笔记
              </button>
            </MenuItem>
          </MenuItems>
        </Menu>
      </header>

      {/* 执行历史（菜单功能） */}
      <HistorySheet
        noteName={note.name}
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
      />

      {/* 代码区 */}
      <main className="min-h-0 flex-1">
        <CodeArea
          ref={codeRef}
          value={text}
          onChange={onChange}
          onFocusChange={setCodeFocused}
          placeholder="写点 OOC…"
        />
      </main>

      {/* 输出区（运行后展开；作为菜单功能的"输出"） */}
      {result && (
        <section className="max-h-[40dvh] shrink-0 overflow-y-auto border-t border-stone-200/70 bg-stone-50 dark:border-zinc-800/70 dark:bg-zinc-900">
          {/* 诊断条 */}
          {hasDiagnostics && (
            <div className="flex items-start gap-2 border-b border-stone-200/60 px-4 py-2 dark:border-zinc-800/60">
              <Warning size={15} className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-500" />
              <ul className="min-w-0 flex-1">
                {result.diagnostics.map((d, i) => (
                  <li
                    key={i}
                    className={`font-mono text-xs leading-relaxed ${
                      d.severity === 'error'
                        ? 'text-rose-600 dark:text-rose-400'
                        : 'text-amber-700 dark:text-amber-400'
                    }`}
                  >
                    {d.message}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="px-4 py-3">
            <div className="flex items-center justify-between text-[11px] uppercase tracking-[0.14em] text-stone-400 dark:text-zinc-500">
              <span>输出</span>
              <span>{result.durationMs.toFixed(1)}ms</span>
            </div>
            <OutputRow value={result.error ?? result.output} />
          </div>
        </section>
      )}

      {/* 移动端键盘上方的符号快捷条（聚焦时显示） */}
      {codeFocused && (
        <QuickKeysBar onInsert={(s) => codeRef.current?.insert(s)} />
      )}
    </div>
  )
}

function OutputRow({ value }: { value: string }) {
  return (
    <pre className="mt-1.5 whitespace-pre-wrap break-words font-mono text-[14px] leading-6 text-stone-900 dark:text-zinc-100">
      {value}
    </pre>
  )
}