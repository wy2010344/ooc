import { useCallback, useEffect, useRef, useState } from 'react'
import type { Engine } from '../lib/engine.js'
import { createEngine } from '../lib/engine.js'
import { store } from '../lib/store.js'
import type { RunResult } from '../lib/run.js'
import { runNote } from '../lib/run.js'

/** 引擎读取笔记时总是拿最新清单（Notes 在 IndexedDB，运行时闭包引用这个 holder） */
const notesHolder: { current: Array<{ name: string; source: string }> } = {
  current: [],
}

let engineCache: Engine | null = null

function getEngine(): Engine {
  if (!engineCache) {
    engineCache = createEngine(() => notesHolder.current)
  }
  return engineCache
}

export function useNotebook() {
  const [notes, setNotes] = useState<Array<{ name: string; source: string }>>([])
  const [active, setActive] = useState<string | null>(null)
  const loaded = useRef(false)

  const refresh = useCallback(async () => {
    const list = await store.list()
    notesHolder.current = list
    setNotes(list)
  }, [])

  useEffect(() => {
    // StrictMode 会双跑 effect：用 loaded 保证只初始化一次
    if (loaded.current) return
    loaded.current = true
    store
      .list()
      .then(async (list) => {
        // 首次打开：播种演示笔记，让手机上一上手就能跑
        if (list.length === 0) {
          for (const demo of DEMO_NOTES) {
            await store.upsert(demo.name, demo.source)
          }
          const seeded = await store.list()
          notesHolder.current = seeded
          setNotes(seeded)
          setActive(seeded[0]?.name ?? null)
          return
        }
        notesHolder.current = list
        setNotes(list)
        if (list.length > 0) setActive(list[0].name)
      })
  }, [])

  /** 新建笔记：默认内容，切到编辑页并保存 */
  const createNote = useCallback(async (): Promise<string> => {
    const stamp = new Date().toISOString().slice(5, 16).replace('T', ' ').replace(':', '')
    const name = `note-${stamp}.ooc`
    const row = await store.upsert(name, "// 新笔记\n1 + 1\n")
    await refresh()
    setActive(row.name)
    return row.name
  }, [refresh])

  const saveNote = useCallback(
    async (name: string, source: string) => {
      await store.upsert(name, source)
      await refresh()
    },
    [refresh],
  )

  const renameNote = useCallback(
    async (from: string, to: string): Promise<boolean> => {
      const ok = await store.rename(from, to)
      if (ok) {
        await refresh()
        setActive(to)
      }
      return ok
    },
    [refresh],
  )

  const removeNote = useCallback(
    async (name: string) => {
      await store.remove(name)
      const list = await store.list()
      notesHolder.current = list
      setNotes(list)
      setActive((cur) => (cur === name ? list[0]?.name ?? null : cur))
    },
    [],
  )

  const run = useCallback(
    async (name: string, source: string): Promise<RunResult> => {
      // 先落盘再跑，让 #import 其它笔记能看到本笔记最新内容
      await store.upsert(name, source)
      notesHolder.current = notesHolder.current.map((n) =>
        n.name === name.toLowerCase() ? { ...n, source } : n,
      )
      const result = await runNote(getEngine(), name, source)
      // 记录执行历史（菜单里可回看）
      try {
        await store.logRun({
          noteName: name,
          at: new Date().toISOString(),
          output: result.output,
          error: result.error,
          durationMs: result.durationMs,
          diagnostics: result.diagnostics.length,
        })
      } catch {
        // 历史记录失败不影响主流程
      }
      return result
    },
    [],
  )

  return {
    notes,
    active,
    setActive,
    createNote,
    saveNote,
    renameNote,
    removeNote,
    run,
  }
}

export type Notebook = ReturnType<typeof useNotebook>

/** 首次打开时的演示笔记（播种） */
const DEMO_NOTES: Array<{ name: string; source: string }> = [
  {
    name: 'hello.ooc',
    source: `// OOC 记事本：像记事一样写代码，点"运行"看结果\n// 注意：// 是注释，不是除法；除法写 12 / 3\n\nmsg = 'hello ooc';\nmsg |> toUpperCase\n`,
  },
  {
    name: '算术.ooc',
    source: `// 运算符无优先级，左结合；顶层语句用 ; 分隔\n1 + 2 * 3;      // (1+2)*3 = 9\n(1 + 2) * 3;    // 9\n12 / 3;         // 4\n7 % 3           // 1\n`,
  },
  {
    name: 'playground.ooc',
    source: `// 借助注入的宿主对象改页面（类似 Smalltalk）\n// ui add '标签' '文本'：body 里追加元素\nui add 'p' '我从 OOC 生成了这段文字'\n\n// db notes：列出所有笔记\nnotes = db notes;\nnotes\n`,
  },
]