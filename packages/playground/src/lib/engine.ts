import {
  createInterpretAction,
  createTypeCheckAction,
  invoke,
  js,
  loop,
  storage,
} from 'object-oriented-c-language'
import type { Value } from 'object-oriented-c-language'
import type { FileSystemProvider, URI } from 'langium'
import { addEffect, createSignal, memo } from './preview/reactive.js'
import { context, dom, fc, text } from './preview/dom.js'

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
 *   storage / loop / js  —— 语言包内置（ref / repeat / throw / new / fn）
 *   db / ui  —— playground 注入：
 *     db.notes() 列出所有笔记名
 *     db.read '名字' 读取笔记源码
 *     ui.dom '选择器' '属性' '值' 修改页面元素
 *     ui.add '标签' '文本' 追加一个元素
 *     ui.get '选择器' 读取 input 的值
 *   fc / dom / text / context  —— 预览渲染（详见 src/lib/preview/）：
 *     组件：fc apply [ctx,...]；元素：dom.div props children；文本：text / text apply
 *   createSignal / createMemo / createEffect  —— 项目内 reactive 模块（src/lib/preview/reactive.ts，
 *     词语义参考 wy-helper/mve 的信号，调度不依赖 MessageChannel，Node 测试可安全退出）：
 *     响应式状态。signal 是 { get() / set() }，渲染期被读取的信号变化后，
 *     renderForEach 所在区域自动重建（见 preview/ctx.ts）。
 *   emptyList / toSplice  —— 列表辅助：
 *     emptyList 是空数组起点；toSplice 按 (数组, 起, 删, ...增) 返回新数组，
 *     配合 list set 时旧数组不变、信号能察觉变化重渲染。
 *     桥接产出的数组自带非枚举 toSplice 方法，`list get |> toSplice 1 0 {...}` 可用。
 */

/** 给数组挂上非枚举 toSplice 方法（不污染 Array.prototype，只作用于桥接产出的数组） */
function decorateWithToSplice(xs: unknown[]): unknown[] {
  Object.defineProperty(xs, 'toSplice', {
    enumerable: false,
    configurable: true,
    writable: true,
    value(this: unknown[], start: number, deleteCount = 0, ...items: unknown[]) {
      return toSplice(this, start, deleteCount, ...items)
    },
  })
  return xs
}

/** 不可变 splice：返回新数组，原数组不动 */
function toSplice(
  xs: unknown[],
  start: number,
  deleteCount = 0,
  ...items: unknown[]
): unknown[] {
  const s = Math.max(0, Number(start) || 0)
  const d = Math.max(0, Number(deleteCount) || 0)
  const head = Array.prototype.slice.call(xs, 0, s)
  const tail = Array.prototype.slice.call(xs, s + d)
  return decorateWithToSplice(head.concat(items, tail))
}

const emptyList = decorateWithToSplice([])

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
        const m = memo((last?: unknown, inited?: boolean) =>
          invoke(get, [last, inited]),
        )
        return { get: () => m.get() }
      },
    },
    // createEffect apply <lambda> → 在批次刷新时执行 lambda（信号变化驱动）
    createEffect: {
      apply(fn: unknown) {
        addEffect(() => invoke(fn, []))
        return null
      },
    },
    emptyList,
    // toSplice apply <数组> <起> <删> ...<增> → 新数组（也可用数组自带的 |> toSplice）
    toSplice: { apply: toSplice },
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

/** 把解释器返回值格式化为可读文本（对象递归展开绑定值） */
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
  for (const key in value as Record<string, unknown>) {
    const item = (value as Record<string, unknown>)[key]
    let rendered: string
    if (typeof item === 'function') {
      // 绑定值无参调用可取到真实值；方法调用出错退化为 (方法)。
      // preview 方法会真的执行一次预览构建，格式化成输出时跳过它。
      if (key === 'preview') {
        rendered = '(方法)'
      } else {
        try {
          rendered = formatValue(item.call(value))
        } catch {
          rendered = '(方法)'
        }
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