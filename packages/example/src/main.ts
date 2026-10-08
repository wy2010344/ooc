import './style.css'
import { createInterpretAction, delegate, js, storage, sendMessage } from 'object-oriented-c-language'
import type { FileSystemProvider } from 'langium'
import { createContext } from 'mve-core'
import { createSignal, memo, addEffect } from 'wy-helper'
import { dom, html, text, fc, forEach } from 'ooc-mve-bridge'
import { createRoot } from 'mve-dom'

// OOC 项目（本目录）：源码 src/ooc/ + 项目配置 config.ooc（顶层）。
// 依赖经 `ooc install` 装进 .ooc_modules/：vite `?raw` eager 预加载
// 项目源码与已安装包源码进内存，解释器在浏览器里按虚拟路径递归解析：
//   /ooc/<file>                项目源码（src/ooc/，basename 与路径对应）
//   /ooc-pkg/<pkg>/<file>      已安装包（.ooc_modules/<pkg>/<file>）
// 虚拟路径与解析结果一一对应，不依赖 basename 去重。
const rawModules = import.meta.glob(
  ['./ooc/*.ooc', '../.ooc_modules/*/*.ooc'],
  {
    query: '?raw',
    import: 'default',
    eager: true,
    // vite 默认跳过隐藏目录（.ooc_modules），exhaustive 让 glob 能扫描已安装依赖
    exhaustive: true,
  },
)
const moduleSources = new Map<string, string>()
for (const [p, content] of Object.entries(rawModules)) {
  // './ooc/math.ooc'  → /ooc/math.ooc
  // '../.ooc_modules/base/loop.ooc' → /ooc-pkg/base/loop.ooc
  const norm = normalizeGlobKey(p)
  if (norm) {
    moduleSources.set(norm, content as string)
  }
}

function normalizeGlobKey(globPath: string): string | undefined {
  const posix = globPath.replace(/\\/g, '/')
  const pkg = posix.match(/\.ooc_modules\/([^/]+)\/(.+)$/)
  if (pkg) {
    return `/ooc-pkg/${pkg[1]}/${pkg[2]}`
  }
  const own = posix.match(/ooc\/([^/]+)$/)
  if (own) {
    return `/ooc/${own[1]}`
  }
  return undefined
}

// 浏览器虚拟文件系统：#import 的模块源码按虚拟路径从内存 map 读取。
// 包引用路径（/ooc-pkg/base/loop.ooc）已在 glob 加载时登记，无需再映射。
const fileSystemProvider: FileSystemProvider = {
  stat(uri) {
    if (moduleSources.has(uri.path)) {
      return Promise.resolve({ isFile: true, isDirectory: false, uri })
    }
    return Promise.reject(new Error(`文件不存在: ${uri.path}`))
  },
  statSync(uri) {
    if (moduleSources.has(uri.path)) {
      return { isFile: true, isDirectory: false, uri }
    }
    throw new Error(`文件不存在: ${uri.path}`)
  },
  exists(uri) {
    return Promise.resolve(moduleSources.has(uri.path))
  },
  existsSync(uri) {
    return moduleSources.has(uri.path)
  },
  async readBinary() {
    return new Uint8Array()
  },
  readBinarySync() {
    return new Uint8Array()
  },
  readFile(uri) {
    const source = moduleSources.get(uri.path)
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
    delegate,
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

// 运行 OOC 入口（虚拟路径 /ooc/app.ooc 对应 src/ooc/app.ooc）→ 挂载 preview 到容器
const container = document.getElementById('app')!
const errBox = document.getElementById('error')!

async function boot() {
  try {
    const value = await interpret.interpretPath('/ooc/app.ooc')
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
