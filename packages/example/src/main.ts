import './style.css'
import { createInterpretAction } from 'object-oriented-c-language'
import type { Value } from 'object-oriented-c-language'
import type { FileSystemProvider, URI } from 'langium'

// #import 模块：esbuild 的 text loader 把每个 .ooc 源码打进 bundle，
// 供解释器在浏览器里按路径递归解析执行
import aaRaw from './ooc/aa.ooc'
import abcRaw from './ooc/abc.ooc'
import basicsRaw from './ooc/basics.ooc'
import demoRaw from './ooc/demo.ooc'
import errorsRaw from './ooc/errors.ooc'
import genericsRaw from './ooc/generics.ooc'
import helloRaw from './ooc/hello.ooc'
import inheritanceRaw from './ooc/inheritance.ooc'
import lambdaRaw from './ooc/lambda.ooc'
import mathRaw from './ooc/math.ooc'
import objectsRaw from './ooc/objects.ooc'
import pipelineRaw from './ooc/pipeline.ooc'
import typedefInheritanceRaw from './ooc/typedef-inheritance.ooc'
import typedefRaw from './ooc/typedef.ooc'
import typesRaw from './ooc/types.ooc'
import unionRaw from './ooc/union.ooc'
import xRaw from './ooc/x.ooc'

const moduleSources = new Map<string, string>(
  Object.entries({
    'aa.ooc': aaRaw,
    'abc.ooc': abcRaw,
    'basics.ooc': basicsRaw,
    'demo.ooc': demoRaw,
    'errors.ooc': errorsRaw,
    'generics.ooc': genericsRaw,
    'hello.ooc': helloRaw,
    'inheritance.ooc': inheritanceRaw,
    'lambda.ooc': lambdaRaw,
    'math.ooc': mathRaw,
    'objects.ooc': objectsRaw,
    'pipeline.ooc': pipelineRaw,
    'typedef-inheritance.ooc': typedefInheritanceRaw,
    'typedef.ooc': typedefRaw,
    'types.ooc': typesRaw,
    'union.ooc': unionRaw,
    'x.ooc': xRaw,
  }),
)

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

// 通用入口：context 注入浏览器虚拟文件系统，其余（解析/校验/执行）与 Node 完全一致
const interpret = createInterpretAction(
  { fileSystemProvider: () => fileSystemProvider },
  { storage, console },
)

const output = document.querySelector<HTMLPreElement>('#output')!
document
  .querySelector<HTMLButtonElement>('#run')!
  .addEventListener('click', async () => {
    output.textContent = '运行中...'
    try {
      const value = await interpret.interpretPath('./demo.ooc')
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
  // 新对象模型就是普通 JS 对象（原型链继承），方法/数据属性都是可枚举属性：
  // 函数为方法，对象为嵌套对象，其余为值。
  const lines: string[] = []
  for (const key in value as Record<string, unknown>) {
    const item = (value as Record<string, unknown>)[key]
    const rendered =
      typeof item === 'function'
        ? '(方法)'
        : item && typeof item === 'object'
          ? '(对象)'
          : JSON.stringify(item)
    lines.push(`  ${key}: ${rendered}`)
  }
  return `{\n${lines.join('\n')}\n}`
}
