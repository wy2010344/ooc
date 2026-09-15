import { useCallback, useEffect, useRef, useState } from 'react'
import { useHashLocation } from 'wouter/use-hash-location'
import { createEngine } from '../lib/engine.js'
import { store } from '../lib/store.js'
import type { RunResult } from '../lib/run.js'
import { runNote } from '../lib/run.js'
import { DEMO_NOTES } from '../demos/index.js'

export function useNotebook() {
  const [notes, setNotes] = useState<Array<{ name: string; source: string }>>(
    [],
  )
  const [active, setActive] = useState<string | null>(null)
  const loaded = useRef(false)

  // 最新笔记列表始终跟着 React state 走（每帧同步 ref）。
  // 不能放模块级变量：Vite HMR 会清空模块作用域，只保留组件 state，
  // 热重载后路由/引擎会读到空列表导致「看不清笔记、点击不进入」。
  const notesRef = useRef<Array<{ name: string; source: string }>>([])
  notesRef.current = notes

  // 引擎懒创建一次并随 state 保留（HMR 不重建）：虚拟 FS 每次实时读 notesRef，
  // 无论何时创建都能看到最新笔记，引擎引用对 Editor/run 始终稳定。
  const [engine] = useState(() => createEngine(() => notesRef.current))

  // wouter 的 hash 定位：location 是去 # 的路径（'/' 或 '/note/<编码名>'），navigate 写回 hash
  const [location, navigateTo] = useHashLocation()

  /** 导航：切到某笔记（或 null 回列表），写进 hash；前进/后退/书签由 location 状态接管 */
  const navigate = useCallback(
    (name: string | null) => {
      navigateTo(name ? `/note/${encodeURIComponent(name)}` : '/')
    },
    [navigateTo],
  )

  /** location 路径 → 当前笔记名（不存在返回 null）：供初始与 location 变化共用 */
  const noteFromRoute = useCallback((route: string) => {
    const m = /^\/note\/(.+)/.exec(route)
    if (!m) return null
    let decoded: string
    try {
      decoded = decodeURIComponent(m[1])
    } catch {
      return null
    }
    const hit = notesRef.current.find(
      (n) => n.name.toLowerCase() === decoded.toLowerCase(),
    )
    return hit ? hit.name : null
  }, [])

  // location 变化（初始、书签直达、前进/后退）→ 同步当前页；
  // 依赖 notes：种子/新建完成后列表就绪，重放一次路由（直达 /note/x 才能命中）
  useEffect(() => {
    setActive(noteFromRoute(location))
  }, [location, noteFromRoute, notes])

  const refresh = useCallback(async () => {
    const list = await store.list()
    setNotes(list)
  }, [])

  useEffect(() => {
    // StrictMode 会双跑 effect：用 loaded 保证只初始化一次
    if (loaded.current) return
    loaded.current = true
    store.list().then(async (list) => {
      // 幂等补种：缺哪个演示笔记就补哪个（已存在的不覆盖，用户改/删过的保持原样）。
      // 这样老用户升级后也能看到新演示（如预览.ooc），不必清空本机数据。
      const missing = DEMO_NOTES.filter(
        (d) => !list.some((n) => n.name.toLowerCase() === d.name.toLowerCase()),
      )
      if (missing.length > 0) {
        for (const demo of missing) {
          await store.upsert(demo.name, demo.source)
        }
      }
      const list2 = await store.list()
      setNotes(list2)
      // 初始页不在此设：location effect 已在首帧按书签/默认路径同步 active
    })
  }, [])

  /** 新建笔记：默认内容，切到编辑页并保存 */
  const createNote = useCallback(async (): Promise<string> => {
    const stamp = new Date()
      .toISOString()
      .slice(5, 16)
      .replace('T', ' ')
      .replace(':', '')
    const name = `note-${stamp}.ooc`
    const row = await store.upsert(name, '// 新笔记\n1 + 1\n')
    await refresh()
    navigate(row.name)
    return row.name
  }, [refresh, navigate])

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
        // store 统一存小写键，这里用全小写去对照列表
        navigate(to.toLowerCase())
      }
      return ok
    },
    [refresh, navigate],
  )

  const removeNote = useCallback(
    async (name: string) => {
      await store.remove(name)
      const list = await store.list()
      setNotes(list)
      // 删掉当前笔记后回列表，简单可预期
      navigate(null)
    },
    [navigate],
  )

  const run = useCallback(
    async (name: string, source: string): Promise<RunResult> => {
      // 先落盘再跑，让 #import 其它笔记能看到本笔记最新内容
      await store.upsert(name, source)
      notesRef.current = notesRef.current.map((n) =>
        n.name === name.toLowerCase() ? { ...n, source } : n,
      )
      const result = await runNote(engine, name, source)
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

  /** 开发面板用：把本地笔记重置为最新演示数据。
   *  overwrite —— 覆盖演示笔记（不删用户笔记）；only-demos —— 清空全部后只留演示。 */
  const resetDemos = useCallback(
    async (mode: 'overwrite' | 'only-demos') => {
      if (mode === 'only-demos') {
        await store.clearNotes()
      }
      for (const d of DEMO_NOTES) {
        await store.upsert(d.name, d.source)
      }
      const list = await store.list()
      setNotes(list)
      navigate(list.length > 0 ? list[0].name : null)
    },
    [navigate],
  )

  return {
    notes,
    active,
    setActive: navigate,
    createNote,
    saveNote,
    renameNote,
    removeNote,
    run,
    resetDemos,
    // 最新演示数据（开发面板展示 + 重置用）
    demos: DEMO_NOTES,
    // 共享引擎：Editor 里的实时重排/lint 也复用同一个 typeCheck（同一套 langium 校验）
    engine,
  }
}

export type Notebook = ReturnType<typeof useNotebook>
