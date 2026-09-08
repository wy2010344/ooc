import { Notebook } from '../hooks/useNotebook.js'
import { Notebook as NotebookIcon } from '@phosphor-icons/react'

interface Props {
  nb: Notebook
}

export function NoteList({ nb }: Props) {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-xl flex-col bg-stone-100 dark:bg-zinc-950">
      {/* 顶栏 */}
      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-stone-200/70 bg-stone-100/90 px-4 py-3 backdrop-blur dark:border-zinc-800/70 dark:bg-zinc-950/90">
        <div className="flex items-center gap-2">
          <NotebookIcon
            size={22}
            weight="fill"
            className="text-emerald-700 dark:text-emerald-500"
          />
          <h1 className="text-[15px] font-semibold tracking-tight text-stone-900 dark:text-zinc-100">
            OOC 记事本
          </h1>
        </div>
        <button
          onClick={() => nb.createNote()}
          className="rounded-full bg-emerald-700 px-4 py-1.5 text-sm font-medium text-white transition-transform active:scale-95 dark:bg-emerald-600"
        >
          新建
        </button>
      </header>

      {/* 列表 */}
      <main className="flex-1 overflow-y-auto px-4 py-3">
        {nb.notes.length === 0 ? (
          <div className="pt-24 text-center">
            <p className="text-sm text-stone-500 dark:text-zinc-500">
              还没有笔记
            </p>
            <button
              onClick={() => nb.createNote()}
              className="mt-4 rounded-full border border-emerald-700 px-5 py-2 text-sm font-medium text-emerald-700 transition-transform active:scale-95 dark:border-emerald-500 dark:text-emerald-500"
            >
              写第一条 OOC
            </button>
          </div>
        ) : (
          <ul className="divide-y divide-stone-200/70 dark:divide-zinc-800/70">
            {nb.notes.map((note) => (
              <li key={note.name}>
                <button
                  onClick={() => nb.setActive(note.name)}
                  className="flex w-full items-start gap-3 py-4 text-left transition-colors active:bg-stone-200/60 dark:active:bg-zinc-900"
                >
                  <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-emerald-600 dark:bg-emerald-500" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-mono text-sm font-medium text-stone-900 dark:text-zinc-100">
                      {note.name}
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-stone-500 dark:text-zinc-500">
                      {preview(note.source)}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  )
}

function preview(source: string): string {
  const line = source.split('\n').map((l) => l.trim()).find(Boolean)
  return (line ?? '').replace(/^\/\//, '').trim() || '空笔记'
}