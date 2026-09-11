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
        notesHolder.current = list2
        setNotes(list2)
        if (list2.length > 0) setActive(list2[0].name)
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
        // store 统一存小写键，这里用全小写去对照列表
        setActive(to.toLowerCase())
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
      // 删掉当前笔记后回列表，简单可预期
      setActive(null)
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

  /** 开发面板用：把本地笔记重置为最新演示数据。
   *  overwrite —— 覆盖演示笔记（不删用户笔记）；only-demos —— 清空全部后只留演示。 */
  const resetDemos = useCallback(async (mode: 'overwrite' | 'only-demos') => {
    if (mode === 'only-demos') {
      await store.clearNotes()
    }
    for (const d of DEMO_NOTES) {
      await store.upsert(d.name, d.source)
    }
    const list = await store.list()
    notesHolder.current = list
    setNotes(list)
    setActive(list.length > 0 ? list[0].name : null)
  }, [])

  return {
    notes,
    active,
    setActive,
    createNote,
    saveNote,
    renameNote,
    removeNote,
    run,
    resetDemos,
    // 最新演示数据（开发面板展示 + 重置用）
    demos: DEMO_NOTES,
    // 共享引擎：Editor 里的实时重排/lint 也复用同一个 typeCheck（同一套 langium 校验）
    engine: getEngine(),
  }
}

export type Notebook = ReturnType<typeof useNotebook>

/** 待办清单演示源码（播种 + 测试共用）：createSignal + forEach + toSpliced 完整示范 */
export const TODO_DEMO = `// 待办清单：createSignal + toSpliced + forEach 区域组件的响应式示范
// 运行后点输出区的「预览」打开：输入 → 添加；点行切换完成态；点「删除」移除。
// 数组用 JS 生态的 Array（globalThis 全局对象）of 构造；不可变改法 / toSpliced（返回新数组）
list = createSignal apply (Array of {name => '搭一个 OOC 预览', done => true}
    {name => '让列表响应信号', done => false});
// 输入框是受控组件：value => inputText（绑定信号对象）→ 显示 get、输入自动写回 set。
// 读当前输入直接读信号：inputText get，不再 ui get '#todo-input' 去 querySelector 强读。
inputText = createSignal apply '';
add = [v => list get / toSpliced 0 0 {name => v, done => false} | list set];
toggle = [i => item = list get/ at i; list get / toSpliced i 1 {name => item name, done => item done/ not} | list set];
remove = [i => list get / toSpliced i 1 | list set];
statusOf = [d => d && '[x] ' || '[ ] '];
{
    preview(ctx){
        // 关闭预览时执行：可在这里清理资源
        ctx addDestroy [console log '待办预览关闭';];
        ctx addNode (
            dom div {className => 'space-y-3'}
                (text bind '待办清单')
                // 剩余项数：text bind <λ> 的派生文本——读 list get 自动跟随，
                // 无需再包一个 forEach 区域（信号一变就在原地重写这段文本）
                (text bind [m = list get /filter [x => x done /not]/length; '剩余 ' + m + ' 项'])
                // 列表区域：每行可切换完成态 / 删除，读到的信号一变化整段重建
                // / 是级联（结果继续发消息）：list get / forEach [...] ⇔ (list get) |> forEach [...]
                // key 用数组下标即可（也可用 item 上唯一字段，React 处理 key 同理）
                // forEach 是区域组件：forEach apply { forEach(block){...}, creater(ic, et, key){...} }
                // 内部走 Ctx.renderForEach，不用自己拿 ctx
                (forEach apply {
                    forEach(block) { list get / forEach [item, idx => block apply idx item] },
                    creater(ic, et, key) {
                        ic addNode (
                            dom div {className = 'flex items-center gap-2 rounded-lg bg-stone-100 px-3 py-2 dark:bg-zinc-800'}
                                // onClick 直接写方法调用；单参数可提前做管道：et index|remove apply ⇔ remove apply (et index)
                                (dom button {onClick => et index|toggle apply}
                                    // 级联+管道一体：et value/ done|statusOf apply ⇔ statusOf apply ((et value)/ done)
                                    // 作为 text bind 实参时必须整段括起来，否则 value 会被空格拆成裸标识符
                                    (text bind (et value/ done|statusOf apply))
                                    (text bind (et value/ name)))
                                (dom button {onClick => et index|remove apply} (text bind '删除'))
                        )
                    }
                })
                (dom div {className = 'flex gap-2'}
                    (dom input {id => 'todo-input', value => inputText, className = 'w-full rounded-lg border border-stone-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900'})
                    (dom button {className = 'rounded-full bg-emerald-700 px-3 py-1.5 text-sm text-white dark:bg-emerald-600', onClick => [e => inputText get | add apply; inputText set '']}
                        (text bind '添加'))
                )
        )
    }
}
`;

/** 预览演示源码（播种 + 测试共用，避免两份漂移） */
export const PREVIEW_DEMO = `// 预览：运行后点输出区的「预览」打开全屏。
// 组件 = fc apply [ctx, 参数 => 用 ctx.addNode 往界面里放节点]
// 响应式状态：createSignal apply 初值 → { get, set }；渲染里读到的信号一变，forEach 区域自动重建。
list = createSignal apply (Array of);
// 输入框是受控组件：绑定信号对象（value => newName）后，用户输入自动 set，读值走 newName get。
newName = createSignal apply '';
Card = fc apply [ctx, title, count =>
    ctx addNode (
        dom div {className => 'rounded-xl bg-emerald-100 p-3 dark:bg-emerald-950/50'}
            (text bind title)
            (dom div {className => 'mt-1 font-mono text-sm text-emerald-800 dark:text-emerald-400'}
                (text bind count)
            )
    )
];
// 事件直接绑「方法本身」：onClick => addItem / delFirst，点击时由宿主调用。
// 注意先快照 newItem = (newName get) 再清空信号：行对象 {name => newItem} 是渲染时才取值的，
// 若直接 {name => (newName get)}，同批冲刷里会读到已清空的值。
addItem = [e => xs = list get; newItem = (newName get); list set (xs / toSpliced 0 0 {name => newItem, done => false}); newName set ''];
delFirst = [list get / toSpliced 0 1 | list set];

{
    preview(ctx){
        // 关闭预览时执行：可在这里清理资源
        ctx addDestroy [console log '预览关闭：清理执行';];
        ctx addNode (
            dom div {className => 'space-y-3'}
                (text bind '组件示例')
                (Card apply '标题' 8)
                // 点击时再 addNode：构造期结束后的 ctx 仍能把节点挂进预览（界面会"动"）
                (dom button {
                    className => 'rounded-full bg-amber-600 px-3 py-1.5 text-sm text-white',
                    onClick => [e => ctx addNode (
                        dom div {className => 'rounded-lg bg-amber-100 px-3 py-2 text-amber-800 dark:bg-amber-950/50'}
                            (text bind '点击生效：界面被行为改变了')
                    )]
                } (text bind '点我，向预览里加一段'))
                // 响应式列表：list 变化后整个列表区域重建（改数组返回新数组，旧引用不变）
                // 注意：forEach/creater 要用对象方法（MethodAll）而非绑定值——绑定在消息调用时
                // 只返回绑定结果、不收参数，主机 renderForEach 会 call 不到回调。
                // forEach 是区域组件：forEach apply {...} 内部走 Ctx.renderForEach，无需自取 ctx
                (forEach apply {
                    forEach(block) { list get / forEach [item, idx => block apply idx item] },
                    creater(ic, et, key) {
                        ic addNode (
                            dom div {className => 'rounded-lg bg-emerald-100 px-3 py-2 text-sm text-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-100'}
                                (text bind ((et value) name))
                        )
                    }
                })
                (dom input {id => 'new-item', value => newName, className => 'w-full rounded-lg border border-stone-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900'})
                (dom button {
                    className => 'rounded-full bg-emerald-700 px-3 py-1.5 text-sm text-white dark:bg-emerald-600',
                    onClick => addItem
                } (text bind '添加一项'))
                (dom button {
                    className => 'rounded-full bg-stone-300 px-3 py-1.5 text-sm text-stone-700 dark:bg-zinc-800 dark:text-zinc-200',
                    onClick => delFirst
                } (text bind '删第一项'))
        )
    }
}
`;

/** 首次打开时的演示笔记（播种） */
const DEMO_NOTES: Array<{ name: string; source: string }> = [
  {
    name: 'hello.ooc',
    source: `// OOC 记事本：像记事一样写代码，点"运行"看结果\n// 注意：// 是注释，不是除法；除法写 12 div 3\n\nmsg = 'hello ooc';\nmsg / toUpperCase\n`,
  },
  {
    name: '算术.ooc',
    source: `// 运算符无优先级，左结合；顶层语句用 ; 分隔\n// / 是级联（结果继续发消息），除法用 div：12 div 3\n1 + 2 * 3;      // (1+2)*3 = 9\n(1 + 2) * 3;    // 9\n12 div 3;       // 4\n7 % 3           // 1\n`,
  },
  {
    name: 'playground.ooc',
    source: `// 借助注入的宿主对象改页面（类似 Smalltalk）\n// ui add '标签' '文本'：body 里追加元素\nui add 'p' '我从 OOC 生成了这段文字'\n\n// db notes：列出所有笔记\nnotes = db notes;\nnotes\n`,
  },
  {
    name: '预览.ooc',
    source: PREVIEW_DEMO,
  },
  {
    name: '待办清单.ooc',
    source: TODO_DEMO,
  },
]