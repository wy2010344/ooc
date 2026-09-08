import { useEffect, useState } from 'react'
import { Dialog, DialogBackdrop, DialogPanel, DialogTitle } from '@headlessui/react'
import { ClockCounterClockwise, X } from '@phosphor-icons/react'
import { store, type RunHistoryItem } from '../lib/store.js'

interface Props {
  noteName: string
  open: boolean
  onClose: () => void
}

/** 执行历史：从底部弹出的 sheet（菜单功能，非编辑器常驻区） */
export function HistorySheet({ noteName, open, onClose }: Props) {
  const [items, setItems] = useState<RunHistoryItem[]>([])

  useEffect(() => {
    if (!open) return
    store.historyFor(noteName).then(setItems)
  }, [open, noteName])

  return (
    <Dialog open={open} onClose={onClose} className="relative z-50">
      <DialogBackdrop className="fixed inset-0 bg-black/30 backdrop-blur-sm" />
      <div className="fixed inset-x-0 bottom-0 mx-auto max-w-xl">
        <DialogPanel className="mx-2 mb-2 overflow-hidden rounded-2xl border border-stone-200 bg-white pb-[max(env(safe-area-inset-bottom),0.75rem)] shadow-2xl dark:border-zinc-800 dark:bg-zinc-900">
          <div className="flex items-center justify-between px-4 pt-4">
            <DialogTitle className="flex items-center gap-2 text-sm font-semibold text-stone-900 dark:text-zinc-100">
              <ClockCounterClockwise size={16} className="text-emerald-700 dark:text-emerald-500" />
              执行历史
            </DialogTitle>
            <button
              onClick={onClose}
              aria-label="关闭"
              className="rounded-full p-1.5 text-stone-500 hover:bg-stone-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
            >
              <X size={18} />
            </button>
          </div>

          <div className="mt-2 max-h-[55dvh] overflow-y-auto px-2">
            {items.length === 0 ? (
              <p className="px-3 py-8 text-center text-sm text-stone-400 dark:text-zinc-500">
                还没有运行记录
              </p>
            ) : (
              <ul className="divide-y divide-stone-100 dark:divide-zinc-800/70">
                {items.map((h) => (
                  <li key={h.id} className="px-3 py-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-xs text-stone-400 dark:text-zinc-500">
                        {formatTime(h.at)}
                      </span>
                      <span
                        className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] ${
                          h.error
                            ? 'bg-rose-50 text-rose-600 dark:bg-rose-950/40 dark:text-rose-400'
                            : h.diagnostics > 0
                              ? 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400'
                              : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-500'
                        }`}
                      >
                        {h.error ? '报错' : h.diagnostics > 0 ? '有诊断' : '成功'}
                      </span>
                    </div>
                    <div className="mt-1">
                      {h.error ? (
                        <p className="whitespace-pre-wrap break-words font-mono text-sm text-rose-600 dark:text-rose-400">
                          {h.error}
                        </p>
                      ) : (
                        <>
                          <p className="whitespace-pre-wrap break-words font-mono text-sm text-stone-800 dark:text-zinc-200">
                            {h.output}
                          </p>
                          {h.diagnostics > 0 && (
                            <p className="mt-1 whitespace-pre-wrap break-words font-mono text-xs text-amber-600 dark:text-amber-400">
                              {h.diagnostics} 条诊断（类型/warning）
                            </p>
                          )}
                        </>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </DialogPanel>
      </div>
    </Dialog>
  )
}

function formatTime(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}