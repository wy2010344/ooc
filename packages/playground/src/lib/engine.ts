import {
  createInterpretAction,
  createTypeCheckAction,
  invoke,
  js,
  loop,
  ObjectValue,
  storage,
} from 'object-oriented-c-language'
import type { Value } from 'object-oriented-c-language'
import type { FileSystemProvider, URI } from 'langium'
import { collectSignal, createSignal, memo } from 'wy-helper'
import { context, dom, fc, forEach, text } from './preview/dom.js'

export interface NotebookEntry {
  name: string
  source: string
}

/**
 * 浏览器虚拟文件系统：
 * 笔记本身就是 .ooc 模块，`#import` 其它笔记时从这里按文件名解析。
 * 笔记源码存放在 IndexedDB，由 store.ts 加载后注册进来。
 */
export function createVirtualFs(
  listNotes: () => NotebookEntry[],
): FileSystemProvider {
  const moduleNameOf = (uri: URI) =>
    (decodeURIComponent(uri.path).split('/').filter(Boolean).pop() ?? '').toLowerCase()

  const byName: Record<string, string> = {}
  for (const n of listNotes()) {
    byName[n.name.toLowerCase()] = n.source
  }
  const hasName = (name: string) => byName[name] !== undefined
  return {
    stat(uri) {
      if (hasName(moduleNameOf(uri))) {
        return Promise.resolve({ isFile: true, isDirectory: false, uri })
      }
      return Promise.reject(new Error(`文件不存在: ${uri.path}`))
    },
    statSync(uri) {
      if (hasName(moduleNameOf(uri))) {
        return { isFile: true, isDirectory: false, uri }
      }
      throw new Error(`文件不存在: ${uri.path}`)
    },
    exists(uri) {
      return Promise.resolve(hasName(moduleNameOf(uri)))
    },
    existsSync(uri) {
      return hasName(moduleNameOf(uri))
    },
    async readBinary() {
      return new Uint8Array()
    },
    readBinarySync() {
      return new Uint8Array()
    },
    readFile(uri) {
      const source = byName[moduleNameOf(uri)]
      if (source == null) {
        return Promise.reject(new Error(`模块不存在: ${uri.path}`))
      }
      return Promise.resolve(source)
    },
    readFileSync() {
      throw new Error('浏览器不支持同步读文件')
    },
    readDirectory() {
      return Promise.resolve([])
    },
    readDirectorySync() {
      return []
    },
  }
}

/**
 * 宿主桥接。OOC 源码可以直接按名引用这些对象：
 *   storage / loop / js / ObjectValue  —— 语言包内置（ref / repeat / throw / new / fn / 反射）
 *   db / ui  —— playground 注入：
 *     db.notes() 列出所有笔记名
 *     db.read '名字' 读取笔记源码
 *     ui.dom '选择器' '属性' '值' 修改页面元素
 *     ui.add '标签' '文本' 追加一个元素
 *     ui.get '选择器' 读取 input 的值（旧模式，受控输入应改用 dom input value => 信号）
 *   fc / dom / text / context / forEach  —— 预览渲染（详见 src/lib/preview/）：
 *     组件：fc apply [ctx,...]；元素：dom.div props children；文本：text bind '...'；
 *     列表区域：forEach apply {...}（内部委托 mve renderForEach，无需自取 ctx）；
 *     受控输入：value => 只读 λ 显示 + onValueChange(v) => 信号 set v 写回（带参方法，
 *     宿主把输入框新值作为第一个参数传入成员，参数名 v 在成员体里直接用）。
 *   createSignal / createMemo / createEffect  —— 信号引擎直接复用 wy-helper
 *     （createSignal/collectSignal/memo），不再自研平行实现。批处理调度默认 MessageChannel，
 *     测试环境由 test/preload-batch.mjs 在导入前置空 globalThis.MessageChannel 切到 setTimeout：
 *     响应式状态。signal 是 { get() / set() }，渲染期被读取的信号变化后，
 *     renderForEach 所在区域自动重建（见 preview/ctx.ts 的 key 合成说明）。
 *   Array 等 globalThis 全局 JS 对象直接发消息即可（深度接 JS 生态），如 `(Array of)` 造空数组；
 *     数组不可变改法 `xs / toSpliced 1 0 {...}`（数组原生方法，返回新数组、旧数组不动），
 *     配合 list set，信号能察觉变化重渲染。
 */

export function createGlobals(listNotes: () => NotebookEntry[]) {
  const db = {
    notes() {
      return listNotes().map((n) => n.name)
    },
    read(name: string) {
      const found = listNotes().find(
        (n) => n.name.toLowerCase() === name.toLowerCase(),
      )
      return found ? found.source : 'nil'
    },
  }

  const ui = {
    // ui dom '选择器' '属性' '值' → 修改元素属性，返回是否命中
    dom(selector: string, prop: string, value: unknown) {
      const el = document.querySelector(selector)
      if (!el) return false
      ;(el as unknown as Record<string, unknown>)[prop] = value
      return true
    },
    // ui add '标签' '文本' → body 末尾追加元素
    add(tag: string, text: unknown) {
      const el = document.createElement(tag)
      el.textContent = String(text)
      document.body.appendChild(el)
      return true
    },
    // ui get '选择器' → 读取 input/textarea 当前值（找不到返回空串）
    get(selector: string) {
      const el = document.querySelector(selector) as
        | HTMLInputElement
        | HTMLTextAreaElement
        | null
      return el ? String(el.value ?? '') : ''
    },
  }

  return {
    storage,
    loop,
    js,
    // 反射桥接：ObjectValue isDefined x / messagesOf x / metaOf x —— 判断对象是否是
    // OOC 定义值并读取其元信息（构造时烧录，语言内消息不可见、不可伪造）
    ObjectValue,
    fc,
    dom,
    text,
    context,
    db,
    ui,
    // 响应式信号：createSignal apply <初值> → { get(), set() }
    // 宿主函数要用 { apply } 形态暴露，否则 `fn apply x` 会命中 JS 的
    // Function.prototype.apply（把 x 当 args 数组而非实参）。
    createSignal: { apply: (v: unknown) => createSignal(v) },
    // createMemo apply <lambda> → 记忆化 signal（lambda 读取的信号变化后重算）
    createMemo: {
      apply(get: unknown) {
        const m = memo<unknown>((last?: unknown, inited?: boolean) =>
          invoke(get, [last, inited]),
        )
        return { get: () => m() }
      },
    },
    // createEffect apply <lambda> → 立即执行一次 lambda，读到的信号变化后重跑。
    // wy-helper 的 addEffect 只排程不追踪依赖，故用 collectSignal 压实：
    // collect 收集 lambda 读到的信号，后续批次由回调重跑。
    createEffect: {
      apply(fn: unknown) {
        let started = false
        const collector = collectSignal(() => {
          if (started) invoke(fn, [])
        })
        collector.collect(() => {
          started = true
          return invoke(fn, [])
        })
        return null
      },
    },
    // 区域组件：forEach apply <区域对象> → 组件（内部委托 mve renderForEach，无需自取 ctx）
    forEach,
  } as const
}

export function createEngine(listNotes: () => NotebookEntry[]) {
  const fs = createVirtualFs(listNotes)
  const interpret = createInterpretAction(
    { fileSystemProvider: () => fs },
    createGlobals(listNotes),
  )
  const typeCheck = createTypeCheckAction({ fileSystemProvider: () => fs })
  return { interpret, typeCheck }
}

export type Engine = ReturnType<typeof createEngine>

/**
 * 把解释器返回值格式化为可读文本（对象递归展开绑定值）。
 * - OOC 定义对象（ObjectValue.isDefined）按元信息展示：bind/mutable 无参读缓存值
 *   （bind 构造时求值一次恒返回缓存，安全无副作用）；call（`=>` 方法/事件/guard）
 *   只标 (方法)——绝不调用，因为调用会执行方法体副作用（如 onClick 改信号）。
 * - 宿主对象退回 for-in 逐键展开（get/set 等原生方法也会被展示为值，属既有行为）。
 */
export function formatValue(value: Value): string {
  if (value === null || value === undefined) {
    return 'nil'
  }
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  if (typeof value !== 'object') {
    return String(value)
  }
  const lines: string[] = []
  // OOC 定义对象：元信息驱动，调用安全的才求值，否则标 (方法)
  if (ObjectValue.isDefined(value)) {
    for (const m of ObjectValue.membersOf(value)) {
      const item = (value as Record<string, unknown>)[m.name]
      let rendered: string
      if (m.type === 'call') {
        // 动态方法/事件/guard —— 调用会执行副作用或需参数，绝不调用
        rendered = '(方法)'
      } else if (typeof item === 'function') {
        // bind / mutable 无参调用返回缓存值（bind 恒同、mutable 可读当前值），安全
        try {
          rendered = formatValue(item.call(value))
        } catch {
          rendered = '(方法)'
        }
      } else {
        rendered = '(方法)'
      }
      lines.push(`  ${m.name}: ${rendered}`)
    }
    return `{\n${lines.join('\n')}\n}`
  }
  // 宿主对象（ref/fc/宿主数组等）：退化 for-in 展开，保留既有可读性
  for (const key in value as Record<string, unknown>) {
    const item = (value as Record<string, unknown>)[key]
    let rendered: string
    if (typeof item === 'function') {
      // 宿主方法（get 等）无参调用可读到值；带参/报错退化为 (方法)。
      // OOC 定义对象不会走到这里（上面已按元信息短路）。
      try {
        rendered = formatValue(item.call(value))
      } catch {
        rendered = '(方法)'
      }
    } else if (item && typeof item === 'object') {
      rendered = '(对象)'
    } else {
      rendered = JSON.stringify(item)
    }
    lines.push(`  ${key}: ${rendered}`)
  }
  return `{\n${lines.join('\n')}\n}`
}