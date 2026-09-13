import { useEffect, useRef, useState } from 'react'
import {
  Dialog,
  DialogBackdrop,
  DialogPanel,
  DialogTitle,
} from '@headlessui/react'
import { Eye, X } from '@phosphor-icons/react'
import { sendMessage } from 'object-oriented-c-language'
import { createRoot } from 'mve-dom'

interface Props {
  open: boolean
  onClose: () => void
  value: unknown
}

/** 全屏预览：模块导出对象带 preview(ctx) 时点「预览」弹全屏，关闭时执行 addDestroy */
export function PreviewSheet({ open, onClose, value }: Props) {
  const mount = useRef<HTMLDivElement>(null)
  const [err, setErr] = useState<string | null>(null)

  // 打开即挂载：清空容器，createRoot 在构建窗口里调 preview(ctx)。cycle 依赖 value。
  useEffect(() => {
    if (!open) return
    const box = mount.current
    if (!box) return
    box.replaceChildren()
    setErr(null)
    try {
      return createRoot(box, function (this) {
        sendMessage(value, 'preview', [this])
      })
    } catch (e) {
      setErr(String(e))
    }
  }, [open, value])
  return (
    <Dialog open={open} onClose={onClose} className="relative z-50">
      <DialogBackdrop className="fixed inset-0 bg-black/40 backdrop-blur-sm" />
      <div className="fixed inset-0 mx-auto max-w-xl">
        <DialogPanel className="flex h-full flex-col bg-stone-50 dark:bg-zinc-950">
          <header className="flex shrink-0 items-center justify-between border-b border-stone-200/70 bg-stone-100/90 px-4 py-2.5 backdrop-blur dark:border-zinc-800/70 dark:bg-zinc-950/90">
            <DialogTitle className="flex items-center gap-2 text-sm font-semibold text-stone-900 dark:text-zinc-100">
              <Eye
                size={16}
                className="text-emerald-700 dark:text-emerald-500"
              />
              预览
            </DialogTitle>
            <button
              onClick={onClose}
              aria-label="关闭"
              className="rounded-full p-1.5 text-stone-500 hover:bg-stone-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
            >
              <X size={18} />
            </button>
          </header>

          <div ref={mount} className="min-h-0 flex-1 overflow-y-auto p-4" />

          {err && (
            <p className="shrink-0 whitespace-pre-wrap break-words border-t border-stone-200/70 px-4 py-3 font-mono text-xs text-rose-600 dark:border-zinc-800/70 dark:text-rose-400">
              {err}
            </p>
          )}
        </DialogPanel>
      </div>
    </Dialog>
  )
}
