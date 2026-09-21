import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { FileSystemProvider } from 'langium'
import {
  createInterpretAction,
  js,
  sendMessage,
  storage,
} from 'object-oriented-c-language'
import { describe, expect, test } from './compat.js'

// 浏览器 demo 的自测案例（packages/example/src/ooc）作为单元测试回归，
// 宿主桥接用语言包导出的同一份 storage/js，保证与 main.ts 行为一致。
// example 与 base 包源码共同组成可 #import 的模块集合（与浏览器 FS 同构）。
const fixtures = join(
  import.meta.dirname,
  '..',
  '..',
  'example',
  'src',
  'ooc',
)
const baseDir = join(import.meta.dirname, '..', '..', 'base', 'src')

// 虚拟文件系统：按 basename 供模块源码（example 模块 + base 标准库）。
// 与浏览器 vite glob 行为一致——都是把 .ooc 文件源码注册进内存按名查找。
function memoryFs(): FileSystemProvider {
  const sources = new Map<string, string>()
  for (const dir of [fixtures, baseDir]) {
    for (const file of ['loop.ooc', 'delegate.ooc']) {
      try {
        const name = join(dir, file)
        sources.set(file, readFileSync(name, 'utf-8'))
      } catch {
        // 文件不存在就跳过（两个目录中有的才注册）
      }
    }
  }
  const nameOf = (uri: { path: string }) =>
    decodeURIComponent(uri.path).split('/').filter(Boolean).pop() ?? ''
  return {
    stat(uri) {
      if (sources.has(nameOf(uri))) {
        return Promise.resolve({ isFile: true, isDirectory: false, uri })
      }
      return Promise.reject(new Error(`文件不存在: ${uri.path}`))
    },
    statSync(uri) {
      if (sources.has(nameOf(uri))) {
        return { isFile: true, isDirectory: false, uri }
      }
      throw new Error(`文件不存在: ${uri.path}`)
    },
    exists(uri) {
      return Promise.resolve(sources.has(nameOf(uri)))
    },
    existsSync(uri) {
      return sources.has(nameOf(uri))
    },
    async readBinary() {
      return new Uint8Array()
    },
    readBinarySync() {
      return new Uint8Array()
    },
    readFile(uri) {
      const c = sources.get(nameOf(uri))
      if (c == null) {
        return Promise.reject(new Error(`模块不存在: ${uri.path}`))
      }
      return Promise.resolve(c)
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

function runCase(file: string) {
  const src = readFileSync(join(fixtures, file), 'utf-8')
  const interpreter = createInterpretAction(
    { fileSystemProvider: () => memoryFs() },
    {
      storage,
      js,
    },
  )
  return interpreter.interpret(src, join(fixtures, file))
}

const expectedBinds: Record<string, Record<string, unknown>> = {
  'loop-demo.ooc': {
    loopIterations: 5,
    loopRuns: 3,
    repeatSum: 10,
    repeatTouched: 0,
    sum_1_to_10: 55,
  },
  'js.ooc': { year: 2026, month: 0, called: 42 },
}

describe('browser demo 案例（宿主桥接注入）', () => {
  for (const [file, binds] of Object.entries(expectedBinds)) {
    test(`${file} 的绑定值正确`, async () => {
      const result = await runCase(file)
      for (const [key, value] of Object.entries(binds)) {
        expect(sendMessage(result as object, key, [])).toBe(value)
      }
    })
  }

  test('throw.ooc 通过 js throw 抛错中断执行', async () => {
    await expect(runCase('throw.ooc')).rejects.toThrow(/js 桥接抛错生效/)
  })
})