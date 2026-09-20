import './style.css'
import { createInterpretAction, js, storage } from 'object-oriented-c-language'
import type { Value } from 'object-oriented-c-language'
import type { FileSystemProvider, URI } from 'langium'
import { createContext } from 'mve-core'
import { createSignal, memo, addEffect } from 'wy-helper'
import { dom, html, text, fc, forEach } from 'ooc-mve-bridge'

// #import 模块：vite 的 `?raw` eager 预加载所有 .ooc 源码进内存，
// 供解释器在浏览器里按路径递归解析执行。
// 同时加载 base 包源码（delegate/loop 等语言标准库），#import 可直接引用。
const rawModules = import.meta.glob(
  ['./ooc/*.ooc', '../../base/src/*.ooc'],
  {
    query: '?raw',
    import: 'default',
    eager: true,
  },
)
const moduleSources = new Map<string, string>()
for (const [p, content] of Object.entries(rawModules)) {
  moduleSources.set((p.split('/').pop() ?? '').toLowerCase(), content as string)
}

function moduleNameOf(uri: URI): string {
  return (
    decodeURIComponent(uri.path).split('/').filter(Boolean).pop() ?? ''
  ).toLowerCase()
}

// 浏览器虚拟文件系统：#import 的模块源码从内存 map 读取
const fileSystemProvider: FileSystemProvider = {
  stat(uri) {
    return Promise.resolve({ isFile: true, isDirectory: false, uri })
  },
  statSync(uri) {
    return { isFile: true, isDirectory: false, uri }
  },
  exists(uri) {
    return Promise.resolve(moduleSources.has(moduleNameOf(uri)))
  },
  existsSync(uri) {
    return moduleSources.has(moduleNameOf(uri))
  },
  async readBinary() {
    return new Uint8Array()
  },
  readBinarySync() {
    return new Uint8Array()
  },
  readFile(uri) {
    const source = moduleSources.get(moduleNameOf(uri))
    if (source == null) {
      throw new Error(`模块不存在: ${uri.path}`)
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

// storage/js：宿主桥接对象，由语言包导出（与单元测试共用一份）。
// console、Math 等 JS 全局本来就挂在 globalThis 上，解释器会回退查找，无需注入。
// loop（base 包 OOC 实现）经 #import 引用，见 ooc/loop.ooc。
// 视图桥接：fc/dom/html/text（组件渲染）、createContext（上下文）、createSignal/memo/addEffect（响应式信号）
const interpret = createInterpretAction(
  { fileSystemProvider: () => fileSystemProvider },
  {
    storage,
    js,
    // 视图组件
    fc,
    createContext,
    dom,
    html,
    text,
    // 响应式信号
    createSignal,
    memo,
    addEffect,
    // 区域组件
    forEach,
  },
)

const output = document.querySelector<HTMLPreElement>('#output')!
// 切换入口即可测试不同案例：demo / loop / js / throw / host-globals
const entry = './demo.ooc'
document
  .querySelector<HTMLButtonElement>('#run')!
  .addEventListener('click', async () => {
    output.textContent = '运行中...'
    try {
      const value = await interpret.interpretPath(entry)
      output.textContent = formatValue(value)
    } catch (err) {
      output.textContent = String(err)
    }
  })

function formatValue(value: Value): string {
  if (value === null) {
    return 'nil'
  }
  if (typeof value !== 'object') {
    return JSON.stringify(value)
  }
  // 对象字面量的绑定（key = 表达式）在运行时也是方法函数，无参调用即得绑定值，
  // 递归格式化才能看到真实结果；真正的方法调用出错时退化为 (方法)。
  const lines: string[] = []
  for (const key in value as Record<string, unknown>) {
    const item = (value as Record<string, unknown>)[key]
    let rendered: string
    if (typeof item === 'function') {
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
