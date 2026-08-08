import './style.css'
import { createInterpretAction } from 'object-oriented-c-language'
import type { Value } from 'object-oriented-c-language'
import type { FileSystemProvider, URI } from 'langium'
import source from './demo.ooc?raw'
import oocJsonRaw from './ooc/ooc.json?raw'

// #import 模块：eager 预加载所有 .ooc 进内存。
// 类型校验需要完整工作区（跨模块 typedef 引用），不能按需动态导入。
const rawModules = import.meta.glob('./ooc/*.ooc', {
  query: '?raw',
  import: 'default',
  eager: true,
})
const moduleSources = new Map<string, string>()
for (const [p, content] of Object.entries(rawModules)) {
  moduleSources.set((p.split('/').pop() ?? '').toLowerCase(), content as string)
}
// 项目配置 ooc.json（类似 tsconfig.json）：虚拟 FS 也提供它
moduleSources.set('ooc.json', oocJsonRaw)

function moduleNameOf(uri: URI): string {
  return (
    decodeURIComponent(uri.path)
      .split('/')
      .filter(Boolean)
      .pop() ?? ''
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

// storage：宿主注入的 JS 全局对象，提供可变更的引用（cell）
const storage = {
  ref(initial: unknown) {
    let v = initial
    return {
      get() {
        return v
      },
      set(x: unknown) {
        v = x
        return v
      },
    }
  },
}

// 通用入口：context 注入浏览器虚拟文件系统，其余（解析/校验/执行）与 Node 完全一致
const interpret = createInterpretAction(
  { fileSystemProvider: () => fileSystemProvider },
  { storage },
).interpret

document.querySelector<HTMLPreElement>('#source')!.textContent = source

const output = document.querySelector<HTMLPreElement>('#output')!
document
  .querySelector<HTMLButtonElement>('#run')!
  .addEventListener('click', async () => {
    output.textContent = '运行中...'
    try {
      const value = await interpret(source, 'demo.ooc')
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
  const lines = value.methods.map((m) => {
    const rendered =
      m.type === 'bind' && m.value && typeof m.value === 'object'
        ? '(对象)'
        : m.type === 'bind'
          ? JSON.stringify(m.value)
          : '(方法)'
    return `  ${m.name}: ${rendered}`
  })
  return `{\n${lines.join('\n')}\n}`
}
