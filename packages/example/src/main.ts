import './style.css'
import { createInterpretAction, js, loop, storage } from 'object-oriented-c-language'
import type { Value } from 'object-oriented-c-language'
import type { FileSystemProvider, URI } from 'langium'

// #import 模块：vite 的 `?raw` eager 预加载所有 .ooc 源码进内存，
// 供解释器在浏览器里按路径递归解析执行
const rawModules = import.meta.glob('./ooc/*.ooc', {
  query: '?raw',
  import: 'default',
  eager: true,
})
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

// storage/loop/js：宿主桥接对象，由语言包导出（与单元测试共用一份），
// console、Math 等 JS 全局本来就挂在 globalThis 上，解释器会回退查找，无需注入。
const interpret = createInterpretAction(
  { fileSystemProvider: () => fileSystemProvider },
  { storage, loop, js },
)

const output = document.querySelector<HTMLPreElement>('#output')!
// 切换入口即可测试不同案例：demo / loop / loop-edge / loop-repeat / js / throw / host-globals
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
