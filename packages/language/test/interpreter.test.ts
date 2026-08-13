import { beforeAll, describe, expect, test } from './compat.js'
import { EmptyFileSystem } from 'langium'
import type { FileSystemProvider } from 'langium'
import { NodeFileSystem } from 'langium/node'
import * as nodeFs from 'node:fs/promises'
import * as nodeOs from 'node:os'
import * as nodePath from 'node:path'
import { createInterpretAction } from 'object-oriented-c-language'

let interpreter: ReturnType<typeof createInterpretAction>

beforeAll(async () => {
  interpreter = createInterpretAction(EmptyFileSystem)
})

describe('OOC Interpreter', () => {
  test('变量与算术', async () => {
    const result = await interpreter.interpret(`
            x = 42;
            y = 33;
            x + y
        `)
    expect(result).toBe(75)
  })

  test('对象方法调用', async () => {
    const result = await interpreter.interpret(`
            value = 42;
            calc = {
                add(n) => value + n,
                double = value * 2
            };
            calc double
        `)
    expect(result).toBe(84)
  })

  test('对象方法带参数', async () => {
    const result = await interpreter.interpret(`
            calc = {
                add(n) => n + 1
            };
            calc add 4
        `)
    expect(result).toBe(5)
  })

  test('字符串拼接', async () => {
    const result = await interpreter.interpret(`
            'hello' + ' world'
        `)
    expect(result).toBe('hello world')
  })

  test('布尔值', async () => {
    const result = await interpreter.interpret(`
            t = true;
            f = false;
            t
        `)
    expect(result).toBe(true)
  })

  test('嵌套对象', async () => {
    const result = await interpreter.interpret(`
            outer = {
                inner = {
                    value = 42
                }
            };
            outer inner / value
        `)
    expect(result).toBe(42)
  })

  test('#guard 分支', async () => {
    const result = await interpreter.interpret(`
            obj = {
                fun(a) { #guard a > 5; a }
            };
            obj fun 9
        `)
    expect(result).toBe(9)
  })

  test('剩余参数', async () => {
    const result = await interpreter.interpret(`
            obj = {
                apply(a, ...b) { b }
            };
            obj apply 1 2 3 4
        `)
    expect(result).toEqual([2, 3, 4])
  })

  test('继承调用父方法', async () => {
    const result = await interpreter.interpret(`
            animal = { speak() { "voice } };
            dog = { ...animal, bark() { "wang } };
            dog speak
        `)
    expect(result).toBe('voice')
  })

  test('继承覆盖父方法', async () => {
    const result = await interpreter.interpret(`
            animal = { speak() { "voice } };
            dog = { ...animal, speak() { "wang } };
            dog speak
        `)
    expect(result).toBe('wang')
  })

  test('继承 guard 不通过时向上查找父方法', async () => {
    const result = await interpreter.interpret(`
            base = { foo(x) { #guard x > 10; 'big' } };
            child = { ...base, foo(x) { #guard x < 5; 'small' } };
            child foo 12
        `)
    expect(result).toBe('big')
  })

  test('继承双方 guard 都不通过时方法未定义', async () => {
    await expect(
      interpreter.interpret(`
                base = { foo(x) { #guard x > 10; 'big' } };
                child = { ...base, foo(x) { #guard x < 5; 'small' } };
                child foo 7
            `),
    ).rejects.toThrow('没有定义该方法')
  })

  test('顶层对象 guard 不通过时方法未定义', async () => {
    await expect(
      interpreter.interpret(`
                obj = { foo(x) { #guard x > 10; x } };
                obj foo 3
            `),
    ).rejects.toThrow('没有定义该方法')
  })

  test('bind 属性可读取', async () => {
    const result = await interpreter.interpret(`
            obj = { value = 42 };
            obj value
        `)
    expect(result).toBe(42)
  })

  test('bind 属性继承', async () => {
    const result = await interpreter.interpret(`
            base = { value = 'pet' };
            child = { ...base, extra() { 'ok' } };
            child value
        `)
    expect(result).toBe('pet')
  })

  test('bind 是方法函数：消息带参不覆盖绑定值', async () => {
    const result = await interpreter.interpret(`
            obj = { value = 42 };
            obj value 99;
            obj value
        `)
    expect(result).toBe(42)
  })

  test('可变属性 <= ：无参返回当前值', async () => {
    const result = await interpreter.interpret(`
            counter = { value <= 0 };
            counter value
        `)
    expect(result).toBe(0)
  })

  test('可变属性 <= ：有参修改并返回新值', async () => {
    const result = await interpreter.interpret(`
            counter = { value <= 0 };
            counter value 42
        `)
    expect(result).toBe(42)
  })

  test('可变属性 <= ：修改后无参返回新值', async () => {
    const result = await interpreter.interpret(`
            counter = { value <= 0 };
            counter value 42;
            counter value
        `)
    expect(result).toBe(42)
  })

  test('可变属性 <= ：多次修改', async () => {
    const result = await interpreter.interpret(`
            counter = { value <= 0 };
            counter value 10;
            counter value 20;
            counter value
        `)
    expect(result).toBe(20)
  })

  test('可变属性 <= ：初始值非数字', async () => {
    const result = await interpreter.interpret(`
            obj = { greeting <= 'hello' };
            obj greeting
        `)
    expect(result).toBe('hello')
  })

  test('对象即 JS 对象：属性均为方法函数', async () => {
    const result = await interpreter.interpret(`
            obj = { value = 42, f() { 'f' } };
            obj
        `)
    expect(typeof result.value).toBe('function')
    expect(result.value()).toBe(42)
    expect(typeof result.f).toBe('function')
    expect(result.f()).toBe('f')
    expect(Object.keys(result)).toEqual(['value', 'f'])
  })

  test('继承通过 JS 原型链实现', async () => {
    const child = await interpreter.interpret(`
            base = { value = 'pet', speak() { 'voice' } };
            child = { ...base, extra() { 'ok' } };
            child
        `)
    expect(Object.getPrototypeOf(child).speak).toBeTypeOf('function')
    expect(child.speak()).toBe('voice')
  })

  test('顶层对象为普通 JS 对象（保留 Object.prototype）', async () => {
    const result = await interpreter.interpret(`{ value = 42 }`)
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype)
  })

  test('父方法 this 访问父字段', async () => {
    const result = await interpreter.interpret(`
            base = { name = 'pet' };
            child = { ...base, greet() { responser name } };
            child greet
        `)
    expect(result).toBe('pet')
  })

  test('原生类型属性读取', async () => {
    const result = await interpreter.interpret(`'abcdef' length`)
    expect(result).toBe(6)
  })

  test('原生类型方法执行', async () => {
    const result = await interpreter.interpret(`'abcdef' slice 1 3`)
    expect(result).toBe('bc')
  })

  test('原生类型属性设置', async () => {
    process.env._OOC_TEST_PROP = 'x'
    try {
      const result = await interpreter.interpret(`
            e = process env;
            e _OOC_TEST_PROP 42;
            e _OOC_TEST_PROP
        `)
      expect(result).toBe('42')
    } finally {
      delete process.env._OOC_TEST_PROP
    }
  })

  test('原生类型未绑定走 methodNotFound', async () => {
    await expect(
      interpreter.interpret(`Math _ooc_notexist_method`),
    ).rejects.toThrow('没有定义该方法')
  })

  test('自定义对象未绑定触发 methodNotFound 方法', async () => {
    const result = await interpreter.interpret(`
            obj = {
                methodNotFound(name) { 'fallback:' + name }
            };
            obj foo
        `)
    expect(result).toBe('fallback:foo')
  })

  test('lambda 表达式函数体', async () => {
    const result = await interpreter.interpret(`
            f = [x -> x + 1];
            f apply 41
        `)
    expect(result).toBe(42)
  })

  test('lambda 多参数', async () => {
    const result = await interpreter.interpret(`
            f = [a, b -> a + b];
            f apply 20 22
        `)
    expect(result).toBe(42)
  })

  test('lambda 参数类型注解', async () => {
    const result = await interpreter.interpret(`
            f = [x: number -> x + 1];
            f apply 41
        `)
    expect(result).toBe(42)
  })

  test('lambda 无参', async () => {
    const result = await interpreter.interpret(`
            f = [42];
            f apply
        `)
    expect(result).toBe(42)
  })

  test('lambda 函数体以标识符开头（无参）', async () => {
    const result = await interpreter.interpret(`
            n = 2;
            f = [n * 21];
            f apply
        `)
    expect(result).toBe(42)
  })

  test('lambda 多语句函数体', async () => {
    const result = await interpreter.interpret(`
            f = [x -> y = x + 1; y * 2];
            f apply 20
        `)
    expect(result).toBe(42)
  })

  test('lambda 闭包捕获', async () => {
    const result = await interpreter.interpret(`
            n = 1;
            f = [x -> x + n];
            f apply 41
        `)
    expect(result).toBe(42)
  })

  test('lambda 作为消息参数', async () => {
    const result = await interpreter.interpret(`
            obj = { call(f) => f apply 42 };
            obj call [x -> x * 2]
        `)
    expect(result).toBe(84)
  })

  test('宿主注入的全局对象（storage 可变引用）', async () => {
    const withStorage = createInterpretAction(EmptyFileSystem, {
      storage: {
        ref(initial: number) {
          let v = initial
          return {
            get() {
              return v
            },
            set(x: number) {
              v = x
              return v
            },
          }
        },
      },
    })
    const result = await withStorage.interpret(`
            counter = storage ref 0;
            counter set 3;
            counter set (counter get + 2);
            counter get
        `)
    expect(result).toBe(5)
  })
})

describe('interpretPath 相对路径（Node/CLI）', () => {
  test('相对路径以当前工作目录为基准解析', async () => {
    const tmp = await nodeFs.mkdtemp(nodePath.join(nodeOs.tmpdir(), 'ooc-rel-'))
    const prevCwd = process.cwd()
    try {
      await nodeFs.writeFile(
        nodePath.join(tmp, 'demo.ooc'),
        'x = 40; x + 2',
        'utf8',
      )
      process.chdir(tmp)
      const { interpretPath } = createInterpretAction(NodeFileSystem)
      await expect(interpretPath('./demo.ooc')).resolves.toBe(42)
    } finally {
      process.chdir(prevCwd)
      await nodeFs.rm(tmp, { recursive: true, force: true })
    }
  })
})

/** 内存文件系统：可注入 ooc.json 与虚拟模块 */
function memoryFs(files: Record<string, string>): {
  provider: FileSystemProvider
  set: (name: string, content: string) => void
} {
  const map = new Map<string, string>()
  for (const [k, v] of Object.entries(files)) {
    map.set(k, v)
  }
  function read(uri: import('langium').URI): string {
    const name =
      decodeURIComponent(uri.path).split('/').filter(Boolean).pop() ?? ''
    const content = map.get(name)
    if (content === undefined) {
      throw new Error(`不存在: ${name}`)
    }
    return content
  }
  const provider: FileSystemProvider = {
    stat(uri) {
      return Promise.resolve({ isFile: true, isDirectory: false, uri })
    },
    statSync(uri) {
      return { isFile: true, isDirectory: false, uri }
    },
    exists(uri) {
      const name =
        decodeURIComponent(uri.path).split('/').filter(Boolean).pop() ?? ''
      return Promise.resolve(map.has(name))
    },
    existsSync(uri) {
      const name =
        decodeURIComponent(uri.path).split('/').filter(Boolean).pop() ?? ''
      return map.has(name)
    },
    readBinary() {
      return Promise.resolve(new Uint8Array())
    },
    readBinarySync() {
      return new Uint8Array()
    },
    readFile(uri) {
      return Promise.resolve(read(uri))
    },
    readFileSync(uri) {
      return read(uri)
    },
    readDirectory() {
      return Promise.resolve([])
    },
    readDirectorySync() {
      return []
    },
  }
  return {
    provider,
    set(name, content) {
      map.set(name, content)
    },
  }
}

describe('类型检查与运行是两个独立分支', () => {
  const source = `
            calc = {
                add(a: number, b: number) { a + b }
            };
            calc add 1 'x'
        `

  test('类型诊断（warning）不阻断执行', async () => {
    const fs = memoryFs({})
    const { interpret } = createInterpretAction({
      fileSystemProvider: () => fs.provider,
    })
    const result = await interpret(source, '/proj/demo.ooc')
    expect(result).toBe('1x')
  })

  test('ooc.json 把诊断升为 error 也不阻断执行', async () => {
    const fs = memoryFs({
      'ooc.json': JSON.stringify({
        diagnostics: { callArgsMismatch: 'error' },
      }),
    })
    const { interpret } = createInterpretAction({
      fileSystemProvider: () => fs.provider,
    })
    const result = await interpret(source, '/proj/demo.ooc')
    expect(result).toBe('1x')
  })

  test('隐式 any 参数不阻断执行', async () => {
    const fs = memoryFs({
      'ooc.json': JSON.stringify({
        diagnostics: { noImplicitAny: 'error' },
      }),
    })
    const { interpret } = createInterpretAction({
      fileSystemProvider: () => fs.provider,
    })
    const result = await interpret(
      `calc = { add(n) { n + 1 } }; calc add 41`,
      '/proj/demo.ooc',
    )
    expect(result).toBe(42)
  })

  test('语法错误仍然阻断执行', async () => {
    const fs = memoryFs({})
    const { interpret } = createInterpretAction({
      fileSystemProvider: () => fs.provider,
    })
    await expect(
      interpret(`x = 'abc`, '/proj/demo.ooc'),
    ).rejects.toThrow('Syntax errors')
  })
})

describe('OOC #import 模块', () => {
  test('预加载导入模块：类型可见且运行时正常执行', async () => {
    const fs = memoryFs({
      'math.ooc': `{ add(a: number, b: number): number { a + b } }`,
      'ooc.json': JSON.stringify({}),
    })
    const { interpret } = createInterpretAction({
      fileSystemProvider: () => fs.provider,
    })
    const result = await interpret(
      `math = #import 'math';
       math add 2 3`,
      'demo.ooc',
    )
    expect(result).toBe(5)
  })

  test('导入模块的类型诊断不阻断执行', async () => {
    const fs = memoryFs({
      'math.ooc': `{ add(a: number, b: number): number { a + b } }`,
      'ooc.json': JSON.stringify({
        diagnostics: { callArgsMismatch: 'error' },
      }),
    })
    const { interpret } = createInterpretAction({
      fileSystemProvider: () => fs.provider,
    })
    const result = await interpret(
      `math = #import 'math';
         result: number = math add 1 'x';
         result`,
      'demo.ooc',
    )
    expect(result).toBe('1x')
  })

  test('被导入模块的 typedef 参与当前模块校验', async () => {
    const fs = memoryFs({
      'types.ooc': `Point #type { x: number, y: number }`,
      'ooc.json': JSON.stringify({}),
    })
    const { interpret } = createInterpretAction({
      fileSystemProvider: () => fs.provider,
    })
    const result = await interpret(
      `types = #import 'types';
       p: Point = { x() { 1 }, y() { 2 } };
       p x`,
      'demo.ooc',
    )
    expect(result).toBe(1)
  })
})
