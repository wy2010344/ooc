import {
  createInterpretAction,
  createTypeCheckAction,
  js,
  ObjectValue,
  storage,
} from 'object-oriented-c-language'
import type { Value } from 'object-oriented-c-language'
import type { FileSystemProvider, URI } from 'langium'
import { addEffect, createSignal, memo } from 'wy-helper'
import { createContext } from 'mve-core'
import { dom, html, text, fc, forEach, createBridgeGlobalsTypes } from 'ooc-mve-bridge'

export interface NotebookEntry {
  name: string
  source: string
}

/** 外部库模块：name → source */
export interface LibModules {
  [name: string]: string
}

/**
 * 浏览器虚拟文件系统：
 * 笔记本身就是 .ooc 模块，`#import` 其它笔记时从这里按文件名解析。
 * 笔记源码存放在 IndexedDB，由 store.ts 加载后注册进来。
 * 外部库模块（base/ooc-mve-bridge）在构建时预加载，作为只读基础层。
 */
export function createVirtualFs(
  listNotes: () => NotebookEntry[],
  libModules: LibModules = {},
): FileSystemProvider {
  const moduleNameOf = (uri: URI) =>
    (
      decodeURIComponent(uri.path).split('/').filter(Boolean).pop() ?? ''
    ).toLowerCase()

  // 每次现取最新笔记列表：notesHolder 随 React state 更新（HMR 后仍有效），
  // #import 始终能看到当前全部笔记，不受引擎创建时机限制
  // 外部库模块作为基础层，用户笔记可覆盖同名模块
  const byName = () => {
    const m: Record<string, string> = { ...libModules }
    for (const n of listNotes()) {
      m[n.name.toLowerCase()] = n.source
    }
    return m
  }
  const hasName = (name: string) => byName()[name] !== undefined
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
      const source = byName()[moduleNameOf(uri)]
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
 *   storage / js / ObjectValue  —— 语言包内置（ref / throw / new / 反射）。
 *   循环（loop apply/repeat）是 base 包 OOC 实现（#import 'loop'），不再桥接。
 *   fc / dom / html / text / createContext / forEach  —— 预览渲染（详见 src/lib/preview/）：
 *     组件包装：fc apply [ctx,...]；元素：dom.div 属性对象 子组件...；
 *     动态文本：text apply <字符串或信号 getter>；HTML 片段：html apply ...；
 *     forEach apply {列表提供者, 渲染}（内部委托 mve renderForEach，无需自取 ctx）。
 *     属性分流按元信息：call 成员（`=>` 方法/事件/信号 getter）交给 mve 当函数属性，
 *     其余（bind/mutable）构造时一次性读值作为常量属性。
 *   createSignal / memo / addEffect  —— 响应式原语直接复用 wy-helper，不再自研平行实现。
 *     signal 是 { get() / set() }；渲染期被读取的信号变化后，所在区域自动重建。
 *     批处理调度默认 MessageChannel，测试环境由 test/preload-batch.mjs 置空
 *     globalThis.MessageChannel 切到 setTimeout（见各包 AGENTS.md）。
 *   Array 等 globalThis 全局 JS 对象直接发消息即可（深度接 JS 生态），如 `(Array of)` 造空数组；
 *     数组不可变改法 `xs / toSpliced 1 0 {...}`（数组原生方法，返回新数组、旧数组不动），
 *     配合 list set，信号能察觉变化重渲染。
 */

export function createGlobals() {
  return {
    storage,
    js,
    // 反射桥接：ObjectValue metaOf x —— 读 OOC 定义值的元信息（构造时烧录，
    // 语言内消息不可见、不可伪造）；非定义值返回 undefined
    ObjectValue,
    fc,
    createContext,
    dom,
    html,
    text,
    // 响应式信号：createSignal apply <初值> → { get(), set() }
    createSignal,
    // memo apply <lambda> → 记忆化 signal（lambda 读取的信号变化后重算）
    memo,
    addEffect,
    // 区域组件：forEach apply <区域对象> → 组件（内部委托 mve renderForEach，无需自取 ctx）
    forEach,
  } as const
}

export function createEngine(
  listNotes: () => NotebookEntry[],
  libModules: LibModules = {},
) {
  const fs = createVirtualFs(listNotes, libModules)
  const interpret = createInterpretAction(
    { fileSystemProvider: () => fs },
    createGlobals(),
  )
  const globalsTypes = createBridgeGlobalsTypes()
  const typeCheck = createTypeCheckAction({ fileSystemProvider: () => fs }, globalsTypes)
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
  const meta = ObjectValue.metaOf(value)
  if (meta) {
    meta.forEach((entries) => {
      const head = entries[0]
      // 首位定义优先，与消息分发同语义；bind/mutable 的 meta 条目直接挂着
      // 缓存值（bind 恒返构造值、mutable 为活引用），读它零副作用；
      // call（`=>` 方法/事件/guard）绝不调用，否则会执行方法体副作用（如改信号）
      let rendered: string
      if (head.type === 'call') {
        rendered = '(方法)'
      } else {
        rendered = formatValue(head.value)
      }
      lines.push(`  ${head.name}: ${rendered}`)
    })
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
