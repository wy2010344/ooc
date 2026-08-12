import './style.css'
import { createInterpretAction, invoke } from 'object-oriented-c-language'
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

// loop：OOC 没有控制流关键字，用宿主对象补上。lambda 不是裸 JS 函数，
// 执行要经过语言包的 invoke（等价于 OOC 里的 `fn apply …`）。
const loop = {
  // loop apply fn：只要 fn 返回真值就继续循环（至少调用一次）
  apply(fn: unknown) {
    while (invoke(fn)) {}
    return null
  },
  // loop repeat n fn：恰好执行 fn n 次
  repeat(n: unknown, fn: unknown) {
    const times = Number(n)
    if (!Number.isFinite(times) || times < 0 || Math.floor(times) !== times) {
      throw new TypeError(`loop repeat 需要非负整数次数，收到 ${n}`)
    }
    for (let i = 0; i < times; i++) {
      invoke(fn)
    }
    return null
  },
}

// js：消息传递表达不了的 JS 能力桥接。
//  - js throw 消息       → 抛 JS Error
//  - js new 构造器 参数… → new 构造器(参数…)
//  - js fn lambda        → 把 OOC lambda 包装成真 JS 函数（给定时器/事件回调用）
const js = {
  throw(message: unknown) {
    throw new Error(String(message))
  },
  new(ctor: unknown, ...args: unknown[]) {
    if (typeof ctor !== 'function') {
      throw new TypeError(`js new 需要构造函数，收到 ${ctor}`)
    }
    return new (ctor as new (...a: unknown[]) => unknown)(...args)
  },
  fn(lambda: unknown) {
    return (...args: unknown[]) => invoke(lambda, args)
  },
}

// 通用入口：context 注入浏览器虚拟文件系统，其余（解析/校验/执行）与 Node 完全一致。
// console、Math 等 JS 全局本来就挂在 globalThis 上（解释器会回退查找），无需注入。
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
