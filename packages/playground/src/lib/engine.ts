import {
  createInterpretAction,
  createTypeCheckAction,
  js,
  loop,
  storage,
} from 'object-oriented-c-language'
import type { Value } from 'object-oriented-c-language'
import type { FileSystemProvider, URI } from 'langium'

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
  }

  return { storage, loop, js, db, ui } as const
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
      // 绑定值无参调用可取到真实值；方法调用出错退化为 (方法)
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