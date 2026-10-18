import {
  createInterpretAction,
  createTypeCheckAction,
  merge,
  js,
  OOC_METHOD,
  storage,
} from 'object-oriented-c-language'
import type { Value } from 'object-oriented-c-language'
import type { FileSystemProvider, URI } from 'langium'
import { addEffect, createSignal, memo } from 'wy-helper'
import { createContext } from 'mve-core'
import { dom, html, text, fc, forEach } from 'ooc-mve-bridge'
import { createBridgeGlobalsTypes } from 'ooc-mve-bridge'

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
 *   storage / js / merge —— 语言包内置（ref / throw / new / merge $）。
 *   循环（loop $/repeat）是 base 包 OOC 实现（#import '@base/loop'），不再桥接。
 *   fc / dom / html / text / createContext / forEach  —— 预览渲染（详见 src/lib/preview/）：
 *     组件包装：fc $ [ctx,...]；元素：dom.div 属性对象 子组件...；
 *     动态文本：text $ <字符串或信号 getter>；HTML 片段：html $ ...；
 *     forEach $ {列表提供者, 渲染}（内部委托 mve renderForEach，无需自取 ctx）。
 *     属性分流按 descriptor + 方法标记：带 OOC_METHOD 标记的函数＝方法（绑接收者），
 *     getter＝计算绑定（读一次），其余＝字面量常量/值（原样透传）。
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
    // 合并/兜底桥：merge $ overrides defaults...（overrides 优先，未知按链查找）
    merge,
    fc,
    createContext,
    dom,
    html,
    text,
    // 响应式信号：createSignal $ <初值> → { get(), set() }
    createSignal,
    // memo $ <lambda> → 记忆化 signal（lambda 读取的信号变化后重算）
    memo,
    addEffect,
    // 区域组件：forEach $ <区域对象> → 组件（内部委托 mve renderForEach，无需自取 ctx）
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
  // Route A：全局类型注册表 = 各宿主包自持类型源合并（createBridgeGlobalsTypes：
  // language 内置 storage/js/merge/console ∪ ooc-mve-bridge 视图与信号），
  // 让类型检查看到 dom/createSignal 等桥接对象的真实形状
  const typeCheck = createTypeCheckAction(
    { fileSystemProvider: () => fs },
    createBridgeGlobalsTypes(),
  )
  return { interpret, typeCheck }
}

export type Engine = ReturnType<typeof createEngine>

/**
 * 把解释器返回值格式化为可读文本（对象递归展开绑定值）。
 * - 成员按 descriptor + 方法标记分流：带 OOC_METHOD 标记的函数＝方法（只标 (方法)，
 *   绝不调用——调用会执行方法体副作用，如 onClick 改信号）；getter＝计算绑定（读取
 *   一次，惰性缓存零副作用）；其余＝字面量常量/lambda 值，安全求值展示。
 * - 宿主对象的无标记函数（get 等）无参调用可读到值，带参/报错退化为 (方法)。
 * - 用 seen 集合防环（宿主对象可能自引用）。
 */
export function formatValue(value: Value, seen: Set<object> = new Set()): string {
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
  if (seen.has(value as object)) {
    return '(循环)'
  }
  seen.add(value as object)
  const obj = value as Record<string, unknown>
  const lines: string[] = []
  for (const key of Object.keys(obj)) {
    const desc = Object.getOwnPropertyDescriptor(obj, key)
    const raw = desc ? desc.value : obj[key]
    let rendered: string
    if (desc && (desc.get || desc.set)) {
      // 计算绑定（getter）：惰性一次求值缓存，读它零副作用
      rendered = formatValue(obj[key] as Value, seen)
    } else if (typeof raw === 'function') {
      const fn = raw as ((...a: unknown[]) => unknown) & Record<symbol, unknown>
      if (fn[OOC_METHOD]) {
        // OOC 方法/转发器：绝不调用（可能有副作用）
        rendered = '(方法)'
      } else {
        // 宿主方法（get 等）：无参调用读值，带参/报错退化为 (方法)
        try {
          rendered = formatValue(fn.call(value) as Value, seen)
        } catch {
          rendered = '(方法)'
        }
      }
    } else {
      rendered = formatValue(raw as Value, seen)
    }
    lines.push(`  ${key}: ${rendered}`)
  }
  seen.delete(value as object)
  return `{\n${lines.join('\n')}\n}`
}
