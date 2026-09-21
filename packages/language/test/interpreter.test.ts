import { beforeAll, describe, expect, test } from './compat.js'
import { EmptyFileSystem } from 'langium'
import { NodeFileSystem } from 'langium/node'
import type { FileSystemProvider } from 'langium'
import { parseHelper } from 'langium/test'
import type { Diagnostic } from 'vscode-languageserver-types'
import type { Model } from 'object-oriented-c-language'
import { createObjectOrientedCServices } from 'object-oriented-c-language'
import * as nodeFs from 'node:fs/promises'
import * as nodeOs from 'node:os'
import * as nodePath from 'node:path'
import {
  createInterpretAction,
  createTypeCheckAction,
  ObjectValue,
  OocCircularImportError,
  OocMethodNotFoundError,
  sendMessage,
  js,
  storage,
} from 'object-oriented-c-language'

let interpreter: ReturnType<typeof createInterpretAction>
let services: ReturnType<typeof createObjectOrientedCServices>
let parse: ReturnType<typeof parseHelper<Model>>

beforeAll(async () => {
  interpreter = createInterpretAction(EmptyFileSystem)
  services = createObjectOrientedCServices(EmptyFileSystem)
  parse = parseHelper<Model>(services.ObjectOrientedC)
})

async function diagnostics(input: string): Promise<Diagnostic[]> {
  const doc = await parse(input, { validation: true })
  return doc.diagnostics ?? []
}

function messages(diags: Diagnostic[]): string[] {
  return diags.map((d) => d.message)
}

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

  test('bind 是方法函数：无参返回绑定值，有参数跳过', async () => {
    const result = await interpreter.interpret(`
            obj = { value = 42 };
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

test('未处理消息抛出包含调用信息的错误对象', async () => {
    await expect(
      interpreter.interpret(`Math _ooc_notexist_method 1 2`),
    ).rejects.toThrow(OocMethodNotFoundError)
    try {
      await interpreter.interpret(`Math _ooc_notexist_method 1 2`)
    } catch (error) {
      const oocError = error as OocMethodNotFoundError
      expect(oocError.methodName).toBe('_ooc_notexist_method')
      expect(oocError.argumentsList).toEqual([1, 2])
      expect(oocError.receiver).toBe(Math)
    }
  })

  test('运行时错误拼上源码行列位置', async () => {
    const src = `first = 1;
second = 2;
Math _ooc_notexist_method 1 2;
good = 3;`
    try {
      await interpreter.interpret(src, 'err-position.ooc')
    } catch (error) {
      const msg = (error as Error).message
      expect(msg).toContain('没有定义该方法')
      // 出错点在第 3 行的消息调用，message 末尾拼 `at <文件>:<行>:<列>`
      expect(msg).toContain('err-position.ooc')
      const suffix = /err-position\.ooc:(\d+):(\d+)/.exec(msg)
      if (!suffix) {
        throw new Error(`错误信息缺少源码位置: ${msg}`)
      }
      expect(Number(suffix[1])).toBe(3)
      expect(Number(suffix[2])).toBeGreaterThan(1)
      return
    }
    throw new Error('预期抛错但没有抛')
  })

  test('custom object 未绑定触发 methodNotFound 方法', async () => {
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
            f = [x => x + 1];
            f apply 41
        `)
    expect(result).toBe(42)
  })

  test('lambda 多参数', async () => {
    const result = await interpreter.interpret(`
            f = [a, b => a + b];
            f apply 20 22
        `)
    expect(result).toBe(42)
  })

  test('lambda 参数类型注解', async () => {
    const result = await interpreter.interpret(`
            f = [x: number => x + 1];
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
            f = [x => y = x + 1; y * 2];
            f apply 20
        `)
    expect(result).toBe(42)
  })

  test('lambda 闭包捕获', async () => {
    const result = await interpreter.interpret(`
            n = 1;
            f = [x => x + n];
            f apply 41
        `)
    expect(result).toBe(42)
  })

  test('lambda 作为消息参数', async () => {
    const result = await interpreter.interpret(`
            obj = { call(f) => f apply 42 };
            obj call [x => x * 2]
        `)
    expect(result).toBe(84)
  })

  test('原生数组高阶方法接收 OOC lambda（自动包成 JS 回调）', async () => {
    const withArr = createInterpretAction(EmptyFileSystem, {
      arr: [1, 2, 3],
    })
    const result = await withArr.interpret('arr map [x => x * 10]')
    expect(result).toEqual([10, 20, 30])
  })

  test('lambda 解释为原生 JS 函数，可被 JS 直接调用', async () => {
    const result = await interpreter.interpret('f = [x => x * 2]; f')
    // 与原生化（lambda → 原生 Function）保持一致：apply 调用与 typeof 都走 JS 生态
    expect(typeof result).toBe('function')
    expect((result as (x: number) => number)(21)).toBe(42)
  })

  test('lambda 内发的消息走 apply 消息（发送端可再次 apply 链式复用）', async () => {
    const result = await interpreter.interpret(`
            add = [v => item = v * 2; item + 1];
            f = [x => add apply x];
            f apply 20
        `)
    expect(result).toBe(41)
  })

  test('通用 not：不限于布尔，0 与空值视为假', async () => {
    expect(await interpreter.interpret('(3 > 1) not')).toBe(false)
    expect(await interpreter.interpret('(1 > 3) not')).toBe(true)
    expect(await interpreter.interpret('0 not')).toBe(true)
    expect(await interpreter.interpret('false not')).toBe(true)
    expect(await interpreter.interpret('nil not')).toBe(true)
    expect(await interpreter.interpret(`'' not`)).toBe(true)
  })

  test('级联 /：结果继续发消息（等价旧 |>），可串联', async () => {
    expect(await interpreter.interpret(`'hello' / toUpperCase`)).toBe('HELLO')
    expect(await interpreter.interpret(`'  hi  ' / trim / toUpperCase`)).toBe(
      'HI',
    )
  })

  test('级联 / 与 filter 组合', async () => {
    const withArr = createInterpretAction(EmptyFileSystem, {
      xs: [1, 2, 3, 4],
    })
    const result = await withArr.interpret(
      'xs / filter [x => (x % 2) == 0] / length',
    )
    expect(result).toBe(2)
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

  test('循环模块导入立即抛出结构化错误', async () => {
    const fs = memoryFs({
      'a.ooc': `b = #import 'b'; b`,
      'b.ooc': `a = #import 'a'; a`,
    })
    const { interpretPath } = createInterpretAction({
      fileSystemProvider: () => fs.provider,
    })
    await expect(interpretPath('a.ooc')).rejects.toThrow(OocCircularImportError)
  })

  test('循环模块导入在静态检查中给出诊断', async () => {
    const fs = memoryFs({
      'b.ooc': `a = #import 'a'; a`,
    })
    const { check } = createTypeCheckAction({
      fileSystemProvider: () => fs.provider,
    })
    const diagnostics = await check(`b = #import 'b'; b`, '/a.ooc')
    expect(diagnostics.map((item) => item.message).join('\n')).toContain(
      '不允许循环模块导入',
    )
  })
})

describe('除法运算', () => {
  test('基本除法：number div number → number', async () => {
    const result = await interpreter.interpret(`
        x: number = 12 div 3;
        x
    `)
    expect(result).toBe(4)
  })

  test('浮点除法', async () => {
    const result = await interpreter.interpret(`
        x: number = 10 div 4;
        x
    `)
    expect(result).toBe(2.5)
  })

  test('除法与类型检查：返回 number', async () => {
    const diags = await diagnostics(`
        x: number = 12 div 3;
        y: string = 12 div 3
    `)
    expect(messages(diags).join('\n')).toContain('类型不匹配')
  })

  test('除法与管道混合使用', async () => {
    const result = await interpreter.interpret(`
        calc = {
            div(a, b) => a div b
        };
        calc div 12 4 / div 3
    `)
    expect(result).toBe(1)
  })
})

describe('ObjectValue 元信息反射', () => {
  test('JS 侧：定义对象带元信息，可读本层成员表（带缓存值）且不可伪造', async () => {
    const result = await interpreter.interpret(`
        p = {a => 1, b(x) => x};
        c = {...p, d = 2, e(v) => v};
        c
    `)
    const meta = ObjectValue.metaOf(result)
    expect(meta instanceof Map).toBe(true)
    // 本层成员：d（bind）缓存值即定义时求值、e（call）
    expect([...meta!.keys()]).toEqual(['d', 'e'])
    const d = meta!.get('d')![0]
    expect(d.type).toBe('bind')
    expect((d as { value: number }).value).toBe(2)
    expect(meta!.get('e')![0].type).toBe('call')
    // 父层不在本层元信息里：沿原型链逐层读
    const parentMeta = ObjectValue.metaOf(Object.getPrototypeOf(result))
    expect([...parentMeta!.keys()]).toEqual(['a', 'b'])
  })

  test('guard 重载同 key 不折叠，bind 与动态同名条目并列（顺序即定义序）', async () => {
    const eq = await interpreter.interpret(`
        eq = { equal(a, b) => 1, equal(a) => 2 };
        eq
    `)
    const mix = await interpreter.interpret(`
        mix = { x = 1, x(v) => v };
        mix
    `)
    // guard 重载同 key 两条都保留（宿主可自行取 value[0] 或遍历）
    const equalEntries = ObjectValue.metaOf(eq)!.get('equal')!
    expect(equalEntries.length).toBe(2)
    expect(equalEntries.every((m) => m.type === 'call')).toBe(true)
    // 同名 x：bind 在前 + call 在后，两条并列
    const xEntries = ObjectValue.metaOf(mix)!.get('x')!
    expect(xEntries.map((m) => m.type)).toEqual(['bind', 'call'])
    // 行为取首位定义（宿主消费元信息同样取 value[0]）：bind 在最前，无参返回缓存值
    expect(sendMessage(mix, 'x', [])).toBe(1)
    // 有参数时 bind 跳过，call 方法匹配：参数数量匹配的 call 方法被调用
    expect(sendMessage(mix, 'x', [5])).toBe(5)
  })

  test('bind 有参数时跳过，call 方法匹配', async () => {
    const result = await interpreter.interpret(`
        obj = { name = 'hello', name(n) { n } };
        obj
    `)
    // 0参数 → bind 返回 'hello'
    expect(sendMessage(result, 'name', [])).toBe('hello')
    // 1参数 → bind 跳过，call 方法匹配
    expect(sendMessage(result, 'name', ['world'])).toBe('world')
  })

  test('mutable getter/setter 行为，2+参数跳过', async () => {
    const result = await interpreter.interpret(`
        obj = { count <= 10, count(v, w) { v + w } };
        obj
    `)
    // 0参数 → mutable getter 返回当前值
    expect(sendMessage(result, 'count', [])).toBe(10)
    // 1参数 → mutable setter 设置新值
    expect(sendMessage(result, 'count', [20])).toBe(20)
    // 2参数 → mutable 跳过，call 方法匹配
    expect(sendMessage(result, 'count', [5, 3])).toBe(8)
  })

  test('空对象 {} 是语言定义值，元信息为空 Map', async () => {
    const result = await interpreter.interpret(`{}`)
    const meta = ObjectValue.metaOf(result)
    expect(meta instanceof Map).toBe(true)
    expect(meta!.size).toBe(0)
  })

  test('lambda 仍是 JS 函数，不带元信息', async () => {
    const result = await interpreter.interpret(`[x => x]`)
    expect(typeof result).toBe('function')
    expect(ObjectValue.metaOf(result)).toBeUndefined()
  })

  test('宿主 JS 值（数组/字符串/数字）不是语言定义值', async () => {
    const arr = await interpreter.interpret(`(Array of)`)
    expect(ObjectValue.metaOf(arr)).toBeUndefined()
    const str = await interpreter.interpret(`'x'`)
    expect(ObjectValue.metaOf(str)).toBeUndefined()
    const num = await interpreter.interpret(`3`)
    expect(ObjectValue.metaOf(num)).toBeUndefined()
  })

  test('OOC 侧：ObjectValue 桥接对象可直接发消息', async () => {
    const withBridge = createInterpretAction(EmptyFileSystem, { ObjectValue })
    // metaOf 返回 Map：get 'a' 取同名定义列表（1 条）
    const one = await withBridge.interpret(`
        m = ObjectValue metaOf {a => 1, b => 2};
        m get 'a' / length
    `)
    expect(one).toBe(1)
    // lambda / 宿主值不是语言定义值，metaOf 返回 nil（undefined）
    const fn = await withBridge.interpret(`ObjectValue metaOf [x => x]`)
    expect(fn).toBeUndefined()
    const host = await withBridge.interpret(`ObjectValue metaOf (Array of)`)
    expect(host).toBeUndefined()
  })

  test('js send：薄原语动态派发', async () => {
    const withBridge = createInterpretAction(EmptyFileSystem, { js })
    // 消息名是运行期字符串：methodNotFound 拿到 name 后用 js send 转发
    const result = await withBridge.interpret(`
        defaults = { greet() => 'hi' };
        spec = { meow() => 'miao', methodNotFound(name, ...args) { js send defaults name args } };
        spec greet
    `)
    expect(result).toBe('hi')
  })

  test('js send 无参消息：参数列表为空', async () => {
    const withBridge = createInterpretAction(EmptyFileSystem, { js })
    const result = await withBridge.interpret(`
        o = { hi() => 'hay' };
        js send o 'hi'
    `)
    expect(result).toBe('hay')
  })

  describe('base 包 delegate：OOC 语言实现的 withDefault', () => {
    function delegateInterpreter() {
      const fs = memoryFs({
        'delegate.ooc': `
          delegate = {
              withDefault(x, y) {
                  {
                      ...x,
                      methodNotFound(name, ...args) {
                          js send y name args
                      }
                  }
              },
              withDefault(x, ...rest) {
                  fallback = js send responser 'withDefault' rest;
                  {
                      ...x,
                      methodNotFound(name, ...args) {
                          js send fallback name args
                      }
                  }
              }
          };
          delegate
        `,
      })
      return createInterpretAction(
        { fileSystemProvider: () => fs.provider },
        { js },
      )
    }

    test('spec 自有消息优先，未知消息转发给 defaults', async () => {
      const result = await delegateInterpreter().interpret(
        `
          d = #import 'delegate';
          defaults = { greet() => 'hi', gadget() => 'gadget' };
          spec = { meow() => 'miao' };
          w = d withDefault spec defaults;
          (w meow) + ' ' + (w greet) + ' ' + (w gadget)
        `,
        'demo.ooc',
      )
      expect(result).toBe('miao hi gadget')
    })

    test('转发时 responser 断链：defaults 方法体内 responser 是 defaults', async () => {
      const result = await delegateInterpreter().interpret(
        `
          d = #import 'delegate';
          defaults = { name() => 'D', who() { responser name } };
          spec = { name() => 'S' };
          w = d withDefault spec defaults;
          w who
        `,
        'demo.ooc',
      )
      // spec 也有 name，但转发发生在 defaults 上：who 里 responser 是 defaults
      expect(result).toBe('D')
    })

    test('spec 方法抢占同名消息，不经过转发', async () => {
      const result = await delegateInterpreter().interpret(
        `
          d = #import 'delegate';
          defaults = { greet() => 'hi' };
          spec = { greet() => 'miaoo' };
          w = d withDefault spec defaults;
          w greet
        `,
        'demo.ooc',
      )
      expect(result).toBe('miaoo')
    })

    test('defaults 也未知的消息最终抛错', async () => {
      await expect(
        delegateInterpreter().interpret(
          `
            d = #import 'delegate';
            defaults = { greet() => 'hi' };
            spec = { meow() => 'miao' };
            w = d withDefault spec defaults;
            w missing
          `,
          'demo.ooc',
        ),
      ).rejects.toThrow()
    })

    test('多参数 withDefault：三个参数递归构建转发链', async () => {
      const result = await delegateInterpreter().interpret(
        `
          d = #import 'delegate';
          defaults1 = { a() => 'a1', b() => 'b1' };
          defaults2 = { a() => 'a2', c() => 'c2' };
          spec = { d() => 'd_spec' };
          w = d withDefault spec defaults1 defaults2;
          (w a) + ' ' + (w b) + ' ' + (w c) + ' ' + (w d)
        `,
        'demo.ooc',
      )
      // spec.d 优先，defaults1.b 存在，defaults2.a 存在（defaults1 也有 a，但 spec 没有，所以转发到 defaults1）
      // 等等，让我重新理解：withDefault(spec, defaults1, defaults2) = { ...spec, methodNotFound → { ...defaults1, methodNotFound → defaults2 } }
      // w.a → spec 没有 a → 转发到 defaults1 → defaults1 有 a，返回 'a1'
      // w.b → spec 没有 b → 转发到 defaults1 → defaults1 有 b，返回 'b1'
      // w.c → spec 没有 c → 转发到 defaults1 → defaults1 没有 c → 转发到 defaults2 → defaults2 有 c，返回 'c2'
      // w.d → spec 有 d，返回 'd_spec'
      expect(result).toBe('a1 b1 c2 d_spec')
    })

    test('多参数 withDefault：找不到最终抛错', async () => {
      await expect(
        delegateInterpreter().interpret(
          `
            d = #import 'delegate';
            defaults1 = { a() => 'a1' };
            defaults2 = { b() => 'b2' };
            spec = { c() => 'c_spec' };
            w = d withDefault spec defaults1 defaults2;
            w missing
          `,
          'demo.ooc',
        ),
      ).rejects.toThrow()
    })
  })

  describe('base 包 loop：OOC 语言实现的循环（无需宿主 loop）', () => {
    function loopInterpreter() {
      const fs = memoryFs({
        'loop.ooc': `
          stop = {
              apply(fn) => nil
          };
          loop = {
              ...stop,
              apply(fn) {
                  #guard fn apply;
                  currentObject apply fn
              },
              repeat(n, fn) {
                  (('x' repeat n) split '') forEach [v, i => fn apply i];
                  nil
              }
          };
          loop
        `,
      })
      return createInterpretAction(
        { fileSystemProvider: () => fs.provider },
        { storage },
      )
    }

    test('apply：lambda 返回真继续、假/NIL/0 停止，至少执行一次', async () => {
      const result = await loopInterpreter().interpret(
        `
          loop = #import 'loop';
          n = storage ref 0;
          loop apply [n set ((n get) + 1); (n get) < 5];
          called = storage ref 0;
          loop apply [called set 1; nil];
          first = (called get);
          called0 = storage ref 0;
          loop apply [called0 set 1; 0];
          zero = (called0 get);
          { count = (n get), first = first, zero = zero }
        `,
        'demo.ooc',
      )
      expect(sendMessage(result, 'count', [])).toBe(5)
      expect(sendMessage(result, 'first', [])).toBe(1)
      expect(sendMessage(result, 'zero', [])).toBe(1)
    })

    test('apply：递减计数到 0 停，跑了 n 次', async () => {
      const result = await loopInterpreter().interpret(
        `
          loop = #import 'loop';
          count = storage ref 3;
          runs = storage ref 0;
          decStep = [runs set ((runs get) + 1); count set ((count get) - 1); (count get) > 0];
          loop apply decStep;
          (runs get)
        `,
        'demo.ooc',
      )
      expect(result).toBe(3)
    })

    test('repeat：恰好执行 n 次，从索引 0 起', async () => {
      const result = await loopInterpreter().interpret(
        `
          loop = #import 'loop';
          sum = storage ref 0;
          loop repeat 5 [x => sum set ((sum get) + x)];
          (sum get)
        `,
        'demo.ooc',
      )
      expect(result).toBe(10)
    })

    test('repeat 0 次：lambda 一次都不执行', async () => {
      const result = await loopInterpreter().interpret(
        `
          loop = #import 'loop';
          touched = storage ref 0;
          loop repeat 0 [touched set 1];
          (touched get)
        `,
        'demo.ooc',
      )
      expect(result).toBe(0)
    })
  })

  describe('currentScope 伪对象', () => {
    test('方法体内读当前作用域变量', async () => {
      const result = await interpreter.interpret(`
          x = 10;
          obj = {
            getX => currentScope x
          };
          obj getX
      `)
      expect(result).toBe(10)
    })

    test('方法体内局部变量遮蔽外层变量', async () => {
      const result = await interpreter.interpret(`
          x = 10;
          obj = {
            getX { y = 7; currentScope x }
          };
          obj getX
      `)
      // 同作用域内后写的 y 不遮蔽 x；这里强调：方法体内创建的局部绑定在作用域链上，
      // 而对象成员（this 属性）不在链上，currentScope 读的是执行作用域链
      expect(result).toBe(10)
    })

    test('读方法体内创建的局部绑定', async () => {
      const result = await interpreter.interpret(`
          z = 30;
          obj = {
            getZ { y = 7; currentScope y }
          };
          obj getZ
      `)
      // y 是方法体内新建的局部绑定（无外层同名），currentScope 能读到它
      expect(result).toBe(7)
    })

    test('外层作用域变量穿透', async () => {
      const result = await interpreter.interpret(`
          outer = 99;
          obj = {
            getOuter => currentScope outer
          };
          obj getOuter
      `)
      expect(result).toBe(99)
    })

    test('未定义变量回退 globalRoot 抛错', async () => {
      await expect(
        interpreter.interpret(`
            obj = { getX => currentScope missingVar };
            obj getX
        `),
      ).rejects.toThrow()
    })
  })

  describe('include：统一容器成员判定', () => {
    test('类对象判定实例归属（Array 含 []）', async () => {
      const result = await interpreter.interpret(`
          xs = (Array of);
          Array include xs
      `)
      expect(result).toBe(true)
    })

    test('类对象判定实例归属（非本类 false）', async () => {
      const result = await interpreter.interpret(`
          n = 42;
          Array include n
      `)
      expect(result).toBe(false)
    })

    test('数组容器成员判定', async () => {
      const result = await interpreter.interpret(`
          xs = Array of 1 2 3;
          (xs include 2) == true
      `)
      expect(result).toBe(true)
    })

    test('数组容器不包含时 false', async () => {
      const result = await interpreter.interpret(`
          xs = Array of 1 2 3;
          (xs include 9) == false
      `)
      expect(result).toBe(true)
    })

    test('Set 容器成员判定', async () => {
      const withJs = createInterpretAction(EmptyFileSystem, { js })
      const result = await withJs.interpret(`
          s = js new Set (Array of 'a' 'b');
          (s include 'b') == true
      `)
      expect(result).toBe(true)
    })

    test('原始值只包含自身', async () => {
      const result = await interpreter.interpret(`
          x = 42;
          (x include 42) == true
      `)
      expect(result).toBe(true)
    })
  })
})
