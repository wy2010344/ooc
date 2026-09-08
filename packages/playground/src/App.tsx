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
    return <Editor nb={nb} note={activeNote} />
  }
  return <NoteList nb={nb} />
}