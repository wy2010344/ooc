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
  merge,
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

  test('$ 调用 lambda 与可调用对象', async () => {
    const result = await interpreter.interpret(`
            inc = [x => x + 1];
            obj = { $(x) => x * 3, square(x) => x * x };
            inc $ (obj $ 4) + (obj square 5)
        `)
    expect(result).toBe(38)
  })

  test('$ 中缀可带 0~N 个实参：消息链后直接接 $，无需前置 /', async () => {
    const result = await interpreter.interpret(`
            add = { $(a, b) => a + b };
            obj = { inner { add } };
            (obj inner) $ 20 22
        `)
    expect(result).toBe(42)
  })

  test('$ 中缀零实参', async () => {
    const result = await interpreter.interpret(`
            obj = { make { { $ { 3 + 4 } } } };
            obj make $
        `)
    expect(result).toBe(7)
  })

  test('字符串拼接', async () => {
    const result = await interpreter.interpret(`
            'hello' + ' world'
        `)
    expect(result).toBe('hello world')
  })

  test('模版字符串：文本与洞', async () => {
    const result = await interpreter.interpret(`
            name = 'world';
            'hello \${name}!'
        `)
    expect(result).toBe('hello world!')
  })

  test('模版字符串：洞内表达式与消息链', async () => {
    const result = await interpreter.interpret(`
            n = 3;
            s = 'abc';
            'n=\${n + 1} len=\${s length}'
        `)
    expect(result).toBe('n=4 len=3')
  })

  test('模版字符串：nil 洞渲染为空串', async () => {
    const result = await interpreter.interpret("'a${nil}b'")
    expect(result).toBe('ab')
  })

  test('模版字符串：文本转义还原', async () => {
    const result = await interpreter.interpret("'a\\nb'")
    expect(result).toBe('a\nb')
  })

  test('模版字符串：无洞（普通字符串）', async () => {
    const result = await interpreter.interpret("'just text'")
    expect(result).toBe('just text')
  })

  test('模版字符串：转义 \\$ 不触发插值', async () => {
    const result = await interpreter.interpret("'\\${x}'")
    expect(result).toBe('${x}')
  })

  test('模版字符串：洞内对象字面量按花括号配对', async () => {
    const result = await interpreter.interpret("'o=${ { a = 1 } a }'")
    expect(result).toBe('o=1')
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
                fun(a) {
                    #guard a > 5;
                    a * 2
                    #else;
                    a
                }
            };
            obj fun 9;
            obj fun 3
        `)
    expect(result).toBe(3)
  })

  test('#guard 前的语句先执行（赋值对条件与分支可见）', async () => {
    const result = await interpreter.interpret(`
            obj = {
                fun(a) {
                    t = a * 2;
                    #guard t > 10;
                    t + 1
                    #else;
                    t
                }
            };
            r1 = obj fun 3;
            r2 = obj fun 8;
            Array of r1 r2
        `)
    expect(result).toEqual([6, 17])
  })

  test('剩余参数', async () => {
    const result = await interpreter.interpret(`
            obj = {
                $(a, ...b) { b }
            };
            obj $ 1 2 3 4
        `)
    expect(result).toEqual([2, 3, 4])
  })

  test('消息实参 ...array 展开为多个实参', async () => {
    const result = await interpreter.interpret(`
            obj = { $(...xs) { xs } };
            arr = Array of 1 2 3;
            obj $ ...arr
        `)
    expect(result).toEqual([1, 2, 3])
  })

  test('展开参数与普通实参混用，且可出现在任意位置', async () => {
    const result = await interpreter.interpret(`
            obj = { $(...xs) { xs } };
            arr = Array of 2 3;
            obj $ 1 ...arr 4
        `)
    expect(result).toEqual([1, 2, 3, 4])
  })

  test('非数组的展开参数整体作为单个实参', async () => {
    const result = await interpreter.interpret(`
            obj = { $(...xs) { xs } };
            obj $ ...42
        `)
    expect(result).toEqual([42])
  })

  test('guard 不通过时落入 else 分支（不再视为方法未定义）', async () => {
    const result = await interpreter.interpret(`
                obj = { foo(x) {
                    #guard x > 10;
                    x
                    #else;
                    nil
                } };
                obj foo 3
            `)
    expect(result).toBe(null)
  })

  test('guard 分支全不通过时落入 else 兜底块', async () => {
    const result = await interpreter.interpret(`
            obj = {
                bar(a) {
                    #guard a > 10;
                    'big'
                    #else;
                    'small'
                }
            };
            obj bar 3
        `)
    expect(result).toBe('small')
  })

  test('bind 属性可读取', async () => {
    const result = await interpreter.interpret(`
            obj = { value = 42 };
            obj value
        `)
    expect(result).toBe(42)
  })

  test('bind 是属性成员：消息读取返回绑定值', async () => {
    const result = await interpreter.interpret(`
            obj = { value = 42 };
            obj value
        `)
    expect(result).toBe(42)
  })

  test('bind 惰性求值：构造时不算，首次读取才算', async () => {
    const result = await interpreter.interpret(`
            obj = {
                total = @{ this scale; 10 },
                scale = 3
            };
            obj total
        `)
    expect(result).toBe(10)
  })

  test('bind 惰性求值只算一次：首次读取后缓存', async () => {
    const result = await interpreter.interpret(`
            count = 0;
            obj = { v = @{ count = count + 1; count } };
            a = obj v;
            b = obj v;
            a + b
        `)
    expect(result).toBe(2)
  })

  test('bind 块支持多条语句：局部赋值 + 最后一条是值', async () => {
    const result = await interpreter.interpret(`
            obj = { v = @{ a = 1; b = 2; a + b } };
            obj v
        `)
    expect(result).toBe(3)
  })

  test('bind 块可引用外层变量', async () => {
    const result = await interpreter.interpret(`
            base = 7;
            obj = { v = @{ dummy = 0; base + 1 } };
            obj v
        `)
    expect(result).toBe(8)
  })

  test('{ a = 1 } 仍是对象字面量（未被 bind 块抢占）', async () => {
    const result = await interpreter.interpret(`
            obj = { a = 1 };
            obj a
        `)
    expect(result).toBe(1)
  })

  test('转发属性 <= 惰性 + 多语句块', async () => {
    const result = await interpreter.interpret(`
            counter = { $(x) => x * 10 };
            obj = { ping <= @{ pick = counter; pick } };
            obj ping 5
        `)
    expect(result).toBe(50)
  })

  test('转发属性 <= ：消息转发给委托对象的 $ 执行', async () => {
    const result = await interpreter.interpret(`
            counter = {
                $(x) => x * 2
            };
            obj = { value <= counter };
            obj value 21
        `)
    expect(result).toBe(42)
  })

  test('转发属性 <= ：任意参数数量都转发给 $', async () => {
    const result = await interpreter.interpret(`
            sum2 = {
                $(a, b) => a + b
            };
            obj = { sum <= sum2 };
            obj sum 20 22
        `)
    expect(result).toBe(42)
  })

  test('转发属性 <= ：无参消息也转发（消息名不传给 $）', async () => {
    const result = await interpreter.interpret(`
            greeting = {
                $ => 'hello'
            };
            obj = { greet <= greeting };
            obj greet
        `)
    expect(result).toBe('hello')
  })

  test('转发属性 <= ：消息名不传给 $，实参按位置转发', async () => {
    const result = await interpreter.interpret(`
            echo = {
                $(...args) => args
            };
            obj = { ping <= echo };
            obj ping 1 2 3
        `)
    expect(result).toEqual([1, 2, 3])
  })

  test('转发属性 <= ：委托对象无 $ 时运行时报错', async () => {
    await expect(
      interpreter.interpret(`
                obj = { value <= 5 };
                obj value
            `),
    ).rejects.toThrow()
  })

  test('对象即 JS 对象：字面量绑定为数据属性，成员为方法函数', async () => {
    const result = await interpreter.interpret(`
            obj = { value = 42, f { 'f' }, add(x) => x + 1 };
            obj
        `)
    // 字面量绑定 → 数据属性，JS 直读值
    expect(result.value).toBe(42)
    // 零参成员是方法：JS 直读拿到函数本体，发消息才执行
    expect(typeof result.f).toBe('function')
    expect(sendMessage(result, 'f', [])).toBe('f')
    // 带参成员也是方法函数
    expect(typeof result.add).toBe('function')
    expect(result.add(1)).toBe(2)
    expect(Object.keys(result)).toEqual(['value', 'f', 'add'])
  })

  test('顶层对象为普通 JS 对象（保留 Object.prototype）', async () => {
    const result = await interpreter.interpret(`{ value = 42 }`)
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype)
  })

  test('lambda 保留：零参成员返回 lambda，消息读取不二次 $', async () => {
    // call 形：方法体返回 lambda
    const callImpl = await interpreter.interpret(`
            obj = { handler => [x => x + 1] };
            h = obj handler;
            h $ 41
        `)
    expect(callImpl).toBe(42)
    // bind 形：常量绑定 lambda
    const bindImpl = await interpreter.interpret(`
            obj2 = { handler = [x => x + 1] };
            h = obj2 handler;
            h $ 41
        `)
    expect(bindImpl).toBe(42)
  })

  test('lambda 保留：零参方法体返回 lambda，读取不二次 $', async () => {
    const result = await interpreter.interpret(`
            obj = { handler => [x => x + 1] };
            obj
        `)
    // 零参成员是方法：发消息执行方法体，返回 lambda 本体（不是 lambda 执行结果）
    const lambda = sendMessage(result, 'handler', [])
    expect(typeof lambda).toBe('function')
    expect(sendMessage(lambda, '$', [41])).toBe(42)
  })

  test('方法体内 this 引用自身字段', async () => {
    const result = await interpreter.interpret(`
            obj = { name = 'pet', greet { this name } };
            obj greet
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

  test('methodNotFound 不再是魔法方法：同名方法也不自动兜底', async () => {
    // 解释器不认 methodNotFound 这个名字：OOC 声明了它也只是一个普通方法，
    // 未知消息仍直接抛错（要兜底必须显式 js proxy + handler）。
    await expect(
      interpreter.interpret(`
            obj = { methodNotFound(name) { 'fallback:' + name } };
            obj foo
        `),
    ).rejects.toThrow('没有定义该方法')
  })

  test('未知消息：未包兜底 Proxy 的对象直接抛结构化错误', async () => {
    try {
      await interpreter.interpret(`
            obj = { foo => 1 };
            obj bar 2 3
        `)
      throw new Error('预期抛错但没有抛')
    } catch (error) {
      const oocError = error as OocMethodNotFoundError
      expect(oocError.name).toBe('OocMethodNotFoundError')
      expect(oocError.methodName).toBe('bar')
      expect(oocError.argumentsList).toEqual([2, 3])
    }
  })

  test('lambda 表达式函数体', async () => {
    const result = await interpreter.interpret(`
            f = [x => x + 1];
            f $ 41
        `)
    expect(result).toBe(42)
  })

  test('lambda 多参数', async () => {
    const result = await interpreter.interpret(`
            f = [a, b => a + b];
            f $ 20 22
        `)
    expect(result).toBe(42)
  })

  test('lambda 参数类型注解', async () => {
    const result = await interpreter.interpret(`
            f = [x: number => x + 1];
            f $ 41
        `)
    expect(result).toBe(42)
  })

  test('lambda 无参', async () => {
    const result = await interpreter.interpret(`
            f = [42];
            f $
        `)
    expect(result).toBe(42)
  })

  test('lambda 函数体以标识符开头（无参）', async () => {
    const result = await interpreter.interpret(`
            n = 2;
            f = [n * 21];
            f $
        `)
    expect(result).toBe(42)
  })

  test('lambda 多语句函数体', async () => {
    const result = await interpreter.interpret(`
            f = [x => y = x + 1; y * 2];
            f $ 20
        `)
    expect(result).toBe(42)
  })

  test('lambda 闭包捕获', async () => {
    const result = await interpreter.interpret(`
            n = 1;
            f = [x => x + n];
            f $ 41
        `)
    expect(result).toBe(42)
  })

  test('lambda 作为消息参数', async () => {
    const result = await interpreter.interpret(`
            obj = { call(f) => f $ 42 };
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
    // 与原生化（lambda → 原生 Function）保持一致：$ 调用与 typeof 都走 JS 生态
    expect(typeof result).toBe('function')
    expect((result as (x: number) => number)(21)).toBe(42)
  })

  test('lambda 内发的消息走 $ 消息（发送端可再次 $ 链式复用）', async () => {
    const result = await interpreter.interpret(`
            add = [v => item = v * 2; item + 1];
            f = [x => add $ x];
            f $ 20
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
       p: Point = { x { 1 }, y { 2 } };
       p x`,
      'demo.ooc',
    )
    expect(result).toBe(1)
  })

  test('命名导入：绑定模块顶层声明的值', async () => {
    const fs = memoryFs({
      'greet.ooc': `greeting = 'hello';\nname = 'world';\n{ hi { greeting + ' ' + name } }`,
      'ooc.json': JSON.stringify({}),
    })
    const { interpret } = createInterpretAction({
      fileSystemProvider: () => fs.provider,
    })
    const result = await interpret(
      `#import { greeting, name } 'greet';
       greeting + ' ' + name`,
      'demo.ooc',
    )
    expect(result).toBe('hello world')
  })

  test('命名导入：顶层赋值别名 as', async () => {
    const fs = memoryFs({
      'greet2.ooc': `greeting = 'hi';\ngreeting`,
      'ooc.json': JSON.stringify({}),
    })
    const { interpret } = createInterpretAction({
      fileSystemProvider: () => fs.provider,
    })
    const result = await interpret(
      `#import { greeting as hi } 'greet2';\nhi`,
      'demo.ooc',
    )
    expect(result).toBe('hi')
  })

  test('命名导入值 + 类型导入可同时存在（path 两侧）', async () => {
    const fs = memoryFs({
      'mix.ooc': `factory = { make { 7 } };\nPoint #type { x: number };\n{ note { 'mod' } }`,
      'ooc.json': JSON.stringify({}),
    })
    const { interpret } = createInterpretAction({
      fileSystemProvider: () => fs.provider,
    })
    const result = await interpret(
      `#import { factory } 'mix' { Point };
       p: Point = { x { factory make } };
       p x`,
      'demo.ooc',
    )
    expect(result).toBe(7)
  })

  test('纯类型导入不执行目标模块（无副作用）', async () => {
    const fs = memoryFs({
      'side.ooc': `Point #type { x: number, y: number };\nboom = currentDoesNotExist`,
      'ooc.json': JSON.stringify({}),
    })
    const { interpret } = createInterpretAction({
      fileSystemProvider: () => fs.provider,
    })
    // 若类型导入会执行 side.ooc，则 boom 求值会抛错
    const result = await interpret(
      `#import 'side' { Point };
       p: Point = { x { 1 }, y { 2 } };
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

describe('对象成员运行时形态（标记 + descriptor，无反射）', () => {
  test('字面量绑定=数据属性（构造期一次），计算绑定=getter（惰性一次）', async () => {
    const result = (await interpreter.interpret(`
        c = { d = 2, s = 'x', b = true, z = nil, v = 1 + 2 };
        c
    `)) as Record<string, unknown>
    expect(Object.keys(result)).toEqual(['d', 's', 'b', 'z', 'v'])
    // 纯字面量：直接写数据属性（非 getter）
    expect(Object.getOwnPropertyDescriptor(result, 'd')!.get).toBeUndefined()
    expect(result.d).toBe(2)
    expect(result.s).toBe('x')
    expect(result.b).toBe(true)
    expect(result.z).toBe(null)
    // 计算式：getter，惰性求值读取
    expect(typeof Object.getOwnPropertyDescriptor(result, 'v')!.get).toBe(
      'function',
    )
    expect(result.v).toBe(3)
  })

  test('方法（零参/带参）是只读数据函数，发消息即调用', async () => {
    const result = (await interpreter.interpret(`
        p = { a => 1, b(x) => x };
        p
    `)) as Record<string, unknown>
    const a = Object.getOwnPropertyDescriptor(result, 'a')!
    const b = Object.getOwnPropertyDescriptor(result, 'b')!
    expect(typeof a.value).toBe('function')
    expect(a.get).toBeUndefined()
    expect(a.writable).toBe(false)
    expect(typeof b.value).toBe('function')
    expect(sendMessage(result, 'a', [])).toBe(1)
    expect(sendMessage(result, 'b', [7])).toBe(7)
  })

  test('同名成员：派发取首个定义（唯一性由校验器保证）', async () => {
    const eq = await interpreter.interpret(`
        eq = { equal(a, b) => 1, equal(a) => 2 };
        eq
    `)
    expect(sendMessage(eq, 'equal', [1, 2])).toBe(1)
    expect(sendMessage(eq, 'equal', [9])).toBe(1)
  })

  test('签名方法（无 body）不烧录运行时行为，实现方法正常履职', async () => {
    const result = (await interpreter.interpret(`
        calc = {
            area: number,
            area { 42 }
        };
        calc
    `)) as Record<string, unknown>
    // 签名方法只在类型层有用：运行期只有实现方法一条
    expect(Object.keys(result)).toEqual(['area'])
    expect(sendMessage(result, 'area', [])).toBe(42)
  })

  test('纯签名方法（连实现都没有）运行时未知消息抛错，无成员烧录', async () => {
    const result = await interpreter.interpret(`
        calc = { area: number };
        calc
    `)
    expect(Object.keys(result as object)).toEqual([])
    expect(() => sendMessage(result, 'area', [])).toThrow()
  })

  test('同名 bind/call：派发取首个定义，bind 不因带参而跳过', async () => {
    const result = await interpreter.interpret(`
        obj = { name = 'hello', name(n) { n } };
        obj
    `)
    // bind 在前：任何时候都返回缓存值（派发取首个定义）
    expect(sendMessage(result, 'name', [])).toBe('hello')
    expect(sendMessage(result, 'name', ['world'])).toBe('hello')
  })

  test('转发属性 <= 参数转发给 $（同名成员派发取首个定义）', async () => {
    const result = await interpreter.interpret(`
        delegate = { $(v, w) { v + w } };
        obj = { count <= delegate, count(v, w) { v * w } };
        obj
    `)
    // 2参数请求 $ 实参 [3,4]，忽略同名 call（v*w = 12 不会被选中）
    expect(sendMessage(result, 'count', [3, 4])).toBe(7)
    expect(sendMessage(result, 'count', [5, 6])).toBe(11)
  })

  test('空对象 {} 是语言定义值，无自有成员', async () => {
    const result = await interpreter.interpret(`{}`)
    expect(Object.keys(result as object)).toEqual([])
  })

  test('宿主 JS 值（数组/字符串/数字）不是语言定义对象', async () => {
    const arr = await interpreter.interpret(`(Array of)`)
    expect(Array.isArray(arr)).toBe(true)
    expect(await interpreter.interpret(`'x'`)).toBe('x')
    expect(await interpreter.interpret(`3`)).toBe(3)
  })

  test('js send：薄原语动态派发', async () => {
    const withBridge = createInterpretAction(EmptyFileSystem, { js })
    // 消息名是运行期字符串：兜底 handler 拿到 name 后用 js send 转发
    const result = await withBridge.interpret(`
        defaults = { greet => 'hi' };
        w = js proxy { meow => 'miao' } [name, ...args => js send defaults name args];
        (w meow) + ' ' + (w greet)
    `)
    expect(result).toBe('miao hi')
  })

  test('js send 无参消息：参数列表为空', async () => {
    const withBridge = createInterpretAction(EmptyFileSystem, { js })
    const result = await withBridge.interpret(`
        o = { hi => 'hay' };
        js send o 'hi'
    `)
    expect(result).toBe('hay')
  })

  test('js proxy：宿主对象显式包装，未知消息交给 handler(name, ...args)', async () => {
    const withBridge = createInterpretAction(EmptyFileSystem, { js })
    const result = await withBridge.interpret(`
        o = js new Object;
        js send Object 'assign' o { hi => 'hay' };
        w = js proxy o [name, ...args => 'fb:' + name];
        (w hi) + ' ' + (w ping 7)
    `)
    // 自有消息优先；未命中的交给 handler
    expect(result).toBe('hay fb:ping')
  })

  describe('宿主端 merge：$ 链式委托（host 桥上实现）', () => {
    function delegateInterpreter() {
      // merge 是宿主注入的全局桥（bridges.ts），语言包导出与浏览器 demo 同一份
      return createInterpretAction(
        { fileSystemProvider: () => memoryFs({}).provider },
        { js, merge },
      )
    }

    test('spec 自有消息优先，未知消息转发给 defaults', async () => {
      const result = await delegateInterpreter().interpret(
        `
          defaults = { greet => 'hi', gadget => 'gadget' };
          spec = { meow => 'miao' };
          w = merge $ spec defaults;
          (w meow) + ' ' + (w greet) + ' ' + (w gadget)
        `,
        'demo.ooc',
      )
      expect(result).toBe('miao hi gadget')
    })

    test('转发时 this 也是包装对象：defaults 方法体内 this 回读 spec', async () => {
      const result = await delegateInterpreter().interpret(
        `
          defaults = { name => 'D', who { this name } };
          spec = { name => 'S' };
          w = merge $ spec defaults;
          w who
        `,
        'demo.ooc',
      )
      // 方法以包装对象为 receiver 调用：who 里 this 是 w，w name 走链
      // 先找 spec（spec 优先）→ 'S'。原对象（defaults/spec）只读不写。
      expect(result).toBe('S')
    })

    test('spec 方法抢占同名消息，不经过转发', async () => {
      const result = await delegateInterpreter().interpret(
        `
          defaults = { greet => 'hi' };
          spec = { greet => 'miaoo' };
          w = merge $ spec defaults;
          w greet
        `,
        'demo.ooc',
      )
      expect(result).toBe('miaoo')
    })

    test('lambda 保留：委托链原样透传 getter 返回的 lambda', async () => {
      const result = await delegateInterpreter().interpret(
        `
          spec = {};
          defaults = { handler => [x => x + 1] };
          w = merge $ spec defaults;
          h = w handler;
          h $ 41
        `,
        'demo.ooc',
      )
      expect(result).toBe(42)
    })

    test('defaults 也未知的消息最终抛错', async () => {
      await expect(
        delegateInterpreter().interpret(
          `
            defaults = { greet => 'hi' };
            spec = { meow => 'miao' };
            w = merge $ spec defaults;
            w missing
          `,
          'demo.ooc',
        ),
      ).rejects.toThrow()
    })

    test('多参数 merge：三个参数按链依次查找', async () => {
      const result = await delegateInterpreter().interpret(
        `
          defaults1 = { a => 'a1', b => 'b1' };
          defaults2 = { a => 'a2', c => 'c2' };
          spec = { d => 'd_spec' };
          w = merge $ spec defaults1 defaults2;
          (w a) + ' ' + (w b) + ' ' + (w c) + ' ' + (w d)
        `,
        'demo.ooc',
      )
      // spec.d 优先，defaults1.b 存在，defaults2.a 存在（defaults1 也有 a，但 spec 没有，所以转发到 defaults1）
      // 链式查找按 [spec, defaults1, defaults2] 顺序
      // w.a → spec 没有 a → defaults1 有 a，返回 'a1'
      // w.b → spec 没有 b → defaults1 有 b，返回 'b1'
      // w.c → spec/defaults1 都没有 c → defaults2 有 c，返回 'c2'
      // w.d → spec 有 d，返回 'd_spec'
      expect(result).toBe('a1 b1 c2 d_spec')
    })

    test('多参数 merge：找不到最终抛错', async () => {
      await expect(
        delegateInterpreter().interpret(
          `
            defaults1 = { a => 'a1' };
            defaults2 = { b => 'b2' };
            spec = { c => 'c_spec' };
            w = merge $ spec defaults1 defaults2;
            w missing
          `,
          'demo.ooc',
        ),
      ).rejects.toThrow()
    })

    test('二次拼接：把已组合的 c 再 merge $ d，链不丢', async () => {
      const result = await delegateInterpreter().interpret(
        `
          a = { a1 => 'a1' };
          b = { b1 => 'b1' };
          c = merge $ a b;
          e = merge $ c { e1 => 'e1' };
          (e a1) + ' ' + (e b1) + ' ' + (e e1)
        `,
        'demo.ooc',
      )
      // 组装期把 c 的链展平进 e：链 [a, b, defaultsE]，查 a1/b1 直接命中
      expect(result).toBe('a1 b1 e1')
    })

    test('两次拼接不影响原组合：c 依旧独立可用', async () => {
      const result = await delegateInterpreter().interpret(
        `
          a = { a1 => 'a1' };
          b = { b1 => 'b1' };
          c = merge $ a b;
          e = merge $ c { e1 => 'e1' };
          (c b1) + ' ' + (e b1)
        `,
        'demo.ooc',
      )
      expect(result).toBe('b1 b1')
    })

    test('共享 defaults：多个包装互相不污染原对象', async () => {
      const result = await delegateInterpreter().interpret(
        `
          shared = { tag => 'shared' };
          w1 = merge $ { n1 => 1 } shared;
          w2 = merge $ { n2 => 2 } shared;
          (w1 tag) + '-' + (w2 tag) + '-' + ((w1 n1) + (w2 n2))
        `,
        'demo.ooc',
      )
      // tag 都落在各自包装上，shared 只读不写
      expect(result).toBe('shared-shared-3')
    })
  })

  describe('base 包 loop：OOC 语言实现的循环（无需宿主 loop）', () => {
    function loopInterpreter() {
      const fs = memoryFs({
        'loop.ooc': `
          loop = {
              $(fn) {
                  #guard fn $;
                  this $ fn
                  #else;
                  nil
              },
              repeat(n, fn) {
                  (('x' repeat n) split '') forEach [v, i => fn $ i];
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

    test('$：lambda 返回真继续、假/NIL/0 停止，至少执行一次', async () => {
      const result = await loopInterpreter().interpret(
        `
          loop = #import 'loop';
          n = storage ref 0;
          loop $ [n set ((n get) + 1); (n get) < 5];
          called = storage ref 0;
          loop $ [called set 1; nil];
          first = (called get);
          called0 = storage ref 0;
          loop $ [called0 set 1; 0];
          zero = (called0 get);
          { count = (n get), first = first, zero = zero }
        `,
        'demo.ooc',
      )
      expect(sendMessage(result, 'count', [])).toBe(5)
      expect(sendMessage(result, 'first', [])).toBe(1)
      expect(sendMessage(result, 'zero', [])).toBe(1)
    })

    test('$：递减计数到 0 停，跑了 n 次', async () => {
      const result = await loopInterpreter().interpret(
        `
          loop = #import 'loop';
          count = storage ref 3;
          runs = storage ref 0;
          decStep = [runs set ((runs get) + 1); count set ((count get) - 1); (count get) > 0];
          loop $ decStep;
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
