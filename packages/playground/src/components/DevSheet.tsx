import { useState } from 'react'
import {
  Dialog,
  DialogBackdrop,
  DialogPanel,
  DialogTitle,
} from '@headlessui/react'
import { ArrowsClockwise, CheckCircle, Trash, X } from '@phosphor-icons/react'
import { Notebook } from '../hooks/useNotebook.js'

interface Props {
  nb: Notebook
  open: boolean
  onClose: () => void
}

type ResetMode = 'overwrite' | 'only-demos'

/** 开发面板：把本地笔记重置为最新演示数据（迭代 demo 时用，普通用户不进这里） */
export function DevSheet({ nb, open, onClose }: Props) {
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<ResetMode | null>(null)

  const doReset = async (mode: ResetMode) => {
    if (mode === 'only-demos') {
      // 破坏性操作先确认，避免误触清空用户笔记
      if (!window.confirm('将删除全部笔记、只保留最新演示数据，确定？')) return
    }
    setBusy(true)
    try {
      await nb.resetDemos(mode)
      setDone(mode)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onClose={onClose} className="relative z-50">
      <DialogBackdrop className="fixed inset-0 bg-black/30 backdrop-blur-sm" />
      <div className="fixed inset-x-0 bottom-0 mx-auto max-w-xl">
        <DialogPanel className="mx-2 mb-2 overflow-hidden rounded-2xl border border-stone-200 bg-white pb-[max(env(safe-area-inset-bottom),0.75rem)] shadow-2xl dark:border-zinc-800 dark:bg-zinc-900">
          <div className="flex items-center justify-between px-4 pt-4">
            <DialogTitle className="flex items-center gap-2 text-sm font-semibold text-stone-900 dark:text-zinc-100">
              开发面板
            </DialogTitle>
            <button
              onClick={onClose}
              aria-label="关闭"
              className="rounded-full p-1.5 text-stone-500 hover:bg-stone-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
            >
              <X size={18} />
            </button>
          </div>

          <div className="mt-2 space-y-4 px-4 py-3">
            <section>
              <p className="text-[11px] uppercase tracking-[0.14em] text-stone-400 dark:text-zinc-500">
                演示笔记（{nb.demos.length}）
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {nb.demos.map((d) => (
                  <span
                    key={d.name}
                    className="rounded-full bg-emerald-50 px-2 py-0.5 font-mono text-[11px] text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400"
                  >
                    {d.name}
                  </span>
                ))}
              </div>
              <p className="mt-2 text-xs leading-relaxed text-stone-500 dark:text-zinc-500">
                演示内容以 useNotebook 里 DEMO_NOTES 为准。老用户首次打开只补缺
                （不覆盖），这里可以强制拉到最新。
              </p>
            </section>

            <div className="space-y-2">
              <button
                onClick={() => void doReset('overwrite')}
                disabled={busy}
                className="flex w-full items-center gap-2 rounded-xl bg-emerald-700 px-3 py-2.5 text-left text-sm font-medium text-white transition-transform active:scale-[0.98] disabled:opacity-60 dark:bg-emerald-600"
              >
                <ArrowsClockwise size={15} className="shrink-0" />
                重置为最新演示（覆盖同名，不动用户笔记）
              </button>
              <button
                onClick={() => void doReset('only-demos')}
                disabled={busy}
                className="flex w-full items-center gap-2 rounded-xl border border-rose-300 px-3 py-2.5 text-left text-sm font-medium text-rose-600 transition-transform active:scale-[0.98] disabled:opacity-60 dark:border-rose-900 dark:text-rose-400"
              >
                <Trash size={15} className="shrink-0" />
                清空全部笔记，只保留最新演示
              </button>
              {done && !busy && (
                <p className="flex items-center gap-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-500">
                  <CheckCircle size={14} weight="fill" />
                  {done === 'overwrite'
                    ? '已重置为最新演示，并切到第一则演示'
                    : '已清空并只保留最新演示'}
                </p>
              )}
            </div>
          </div>
        </DialogPanel>
      </div>
    </Dialog>
  )
}