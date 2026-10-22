import { useEffect, useState } from 'react'
import { useNotebook } from './hooks/useNotebook.js'
import { NoteList } from './components/NoteList.js'
import { Editor } from './components/Editor.js'

export function App() {
  const nb = useNotebook()
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => setReady(true), 120)
    return () => clearTimeout(t)
  }, [])

  // 有活动笔记就进编辑器；否则显示笔记列表（空态）
  const activeNote = nb.active
    ? nb.notes.find((n) => n.name === nb.active) ?? null
    : null

  if (!ready) return null

  if (activeNote) {
    // 桌面端（md+）：左侧固定列表 + 右侧编辑器并排；移动端保持单页切换
    return (
      <div className="md:flex">
        <aside className="hidden md:block md:h-dvh md:w-80 md:shrink-0 md:overflow-y-auto md:border-r md:border-stone-200/70 md:dark:border-zinc-800/70">
          <NoteList nb={nb} />
        </aside>
        <div className="min-w-0 flex-1">
          <Editor nb={nb} note={activeNote} />
        </div>
      </div>
    )
  }
  return <NoteList nb={nb} />
}