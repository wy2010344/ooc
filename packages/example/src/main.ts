import './style.css'
import { createInterpretAction, js, storage, sendMessage } from 'object-oriented-c-language'
import type { FileSystemProvider, URI } from 'langium'
import { createContext } from 'mve-core'
import { createSignal, memo, addEffect } from 'wy-helper'
import { dom, html, text, fc, forEach } from 'ooc-mve-bridge'
import { createRoot } from 'mve-dom'

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

// 宿主桥接对象：storage/js、视图组件（dom/text/fc/forEach）、响应式信号（createSignal/memo/addEffect）
const interpret = createInterpretAction(
  { fileSystemProvider: () => fileSystemProvider },
  {
    storage,
    js,
    fc,
    createContext,
    dom,
    html,
    text,
    createSignal,
    memo,
    addEffect,
    forEach,
  },
)

// 运行 OOC 入口 → 挂载 preview 到容器
const container = document.getElementById('app')!
const errBox = document.getElementById('error')!

async function boot() {
  try {
    const value = await interpret.interpretPath('./app.ooc')
    container.replaceChildren()
    errBox.textContent = ''
    createRoot(container, function (this) {
      sendMessage(value, 'preview', [this])
    })
  } catch (err) {
    errBox.textContent = String(err)
  }
}

boot()
