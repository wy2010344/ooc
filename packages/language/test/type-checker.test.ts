import { beforeAll, describe, expect, test } from './compat.js'
import { EmptyFileSystem, URI } from 'langium'
import { parseHelper } from 'langium/test'
import type { Diagnostic } from 'vscode-languageserver-types'
import type { Model } from 'object-oriented-c-language'
import { createObjectOrientedCServices } from 'object-oriented-c-language'

let services: ReturnType<typeof createObjectOrientedCServices>
let parse: ReturnType<typeof parseHelper<Model>>

beforeAll(async () => {
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

describe('类型注解语法解析', () => {
  test('绑定变量带类型', async () => {
    const doc = await parse(`
        x: number = 33;
        y: string = "hello
    `)
    expect(doc.parseResult.parserErrors).toHaveLength(0)
  })

  test('方法参数与返回类型', async () => {
    const doc = await parse(`
        calc = {
            add(a: number, b: number): number { a + b },
            val: string = 'hi'
        }
    `)
    expect(doc.parseResult.parserErrors).toHaveLength(0)
  })

  test('联合类型', async () => {
    const doc = await parse(`
        x: number | string = 33
    `)
    expect(doc.parseResult.parserErrors).toHaveLength(0)
  })

  test('#type 类型别名', async () => {
    const doc = await parse(`
        Point #type {
            x: number,
            y: number
        }
    `)
    expect(doc.parseResult.parserErrors).toHaveLength(0)
  })

  test('管道命名参数', async () => {
    const doc = await parse(`
        data | x => x + 1
    `)
    expect(doc.parseResult.parserErrors).toHaveLength(0)
  })
})

describe('类型检查（warning）', () => {
  test('无类型问题时零警告', async () => {
    const diags = await diagnostics(`
        x: number = 33;
        y = x + 1;
        y
    `)
    expect(messages(diags)).toEqual([])
  })

  test('类型不匹配产生 warning', async () => {
    const diags = await diagnostics(`
        x: number = 'hello'
    `)
    expect(messages(diags).join('\n')).toContain('类型不匹配')
  })

  test('未知类型名产生 warning', async () => {
    const diags = await diagnostics(`
        x: Foo = 33
    `)
    expect(messages(diags).join('\n')).toContain("未知类型 'Foo'")
  })

  test('方法参数类型检查', async () => {
    const diags = await diagnostics(`
        calc = {
            add(a: number, b: number) { a + b }
        };
        calc add 1 'x'
    `)
    expect(messages(diags).join('\n')).toContain('调用参数不匹配')
  })

  test('无注解方法调用不报参数错误', async () => {
    const diags = await diagnostics(`
        calc = {
            add(a, b) { a + b }
        };
        calc add 1 'x'
    `)
    expect(messages(diags)).toEqual([])
  })

  test('返回类型注解检查', async () => {
    const diags = await diagnostics(`
        calc = {
            get(): number { 'not a number' }
        }
    `)
    expect(messages(diags).join('\n')).toContain('类型不匹配')
  })

  test('#guard 条件类型检查', async () => {
    const diags = await diagnostics(`
        obj = {
            fun(a: number) {
                #guard a;
                a
            }
        }
    `)
    expect(messages(diags).join('\n')).toContain('#guard')
  })

  test('无类型标注的 guard 不误报', async () => {
    const diags = await diagnostics(`
        obj = {
            fun(a) {
                #guard a;
                a
            }
        }
    `)
    expect(messages(diags)).toEqual([])
  })

  test('#type 别名做方法调用检查', async () => {
    const diags = await diagnostics(`
        Point #type {
            move(x: number, y: number),
            origin: string
        };
        p: Point = {
            move(x, y) { this },
            origin = 'origin'
        };
        p move 1 'x'
    `)
    expect(messages(diags).join('\n')).toContain('调用参数不匹配')
  })

  test('符合类型定义的对象调用不误报', async () => {
    const diags = await diagnostics(`
        Point #type {
            move(x: number, y: number)
        };
        p: Point = {
            move(x, y) { this }
        };
        p move 1 2
    `)
    expect(messages(diags)).toEqual([])
  })

  test('对象字面量成员类型与 typedef 不符会告警', async () => {
    const diags = await diagnostics(`
        Person #type {
            name: string,
            age: number
        };
        bad: Person = { name = 123, age = 'x' }
    `)
    expect(messages(diags).join('\n')).toContain('类型不匹配')
  })

  test('对象字面量成员类型与 typedef 相符不误报', async () => {
    const diags = await diagnostics(`
        Person #type {
            name: string,
            age: number
        };
        good: Person = { name = 'alice', age = 30 }
    `)
    expect(messages(diags)).toEqual([])
  })

  test('方法参数签名与 typedef 不符会告警', async () => {
    const diags = await diagnostics(`
        Calc #type {
            add(a: number, b: number): number
        };
        c: Calc = {
            add(a, b) { 'not a number' }
        }
    `)
    expect(messages(diags).join('\n')).toContain('类型不匹配')
  })

  test('同名重载返回类型不一致会告警', async () => {
    const diags = await diagnostics(`
        obj = {
            fun() { 1 },
            fun() { 'x' }
        }
    `)
    expect(messages(diags).join('\n')).toContain('重载返回类型不一致')
  })

  test('不同方法不误报重载不一致', async () => {
    const diags = await diagnostics(`
        config = {
            cache() => {
                ttl() => 3600,
                enabled() => true
            },
            logging() => {
                level() => 'info',
                output() => 'console'
            }
        }
    `)
    expect(messages(diags)).toEqual([])
  })
})

describe('真实示例无类型告警', () => {
  test('x.ooc 类型的对象定义不误报', async () => {
    const diags = await diagnostics(`
        obj = {
            apply(a, ...b) {
                console log b
            },
            fun(a, b) {
                #guard a > 9;
                console log a "dddd
            },
            fun(a, b) {
                #guard a < 5;
                console log a 'ff'
            },
            fun(a, b) {
                console log a "xxxx
            }
        };
        obj apply 1 2 3 4;
        obj fun 9
    `)
    // guard 条件 a > 9 是 boolean，不触发警告；console 是 JS 全局 → any
    expect(messages(diags)).toEqual([])
  })

  test('继承对象不误报', async () => {
    const diags = await diagnostics(`
        animal = { speak() { "voice } };
        dog = { ...animal, bark() { "wang } };
        dog speak
    `)
    expect(messages(diags)).toEqual([])
  })

  test('继承对象赋值 typedef 注解不误报', async () => {
    const diags = await diagnostics(`
        Animal #type { speak(): string };
        animal = { speak() { "voice } };
        dog: Animal = { ...animal, bark() { "wang } };
        dog speak
    `)
    expect(messages(diags)).toEqual([])
  })

  test('继承对象缺少父方法告警', async () => {
    const diags = await diagnostics(`
        Animal #type { speak(): string };
        animal = { speak() { "voice } };
        dog: Animal = { bark() { "wang } };
        dog speak
    `)
    expect(messages(diags)[0]).toContain('类型不匹配：期望 Animal')
  })

  test('lambda 推断为函数类型，无多余告警', async () => {
    const diags = await diagnostics(`
        f = [x -> x + 1];
        f apply 41
    `)
    expect(messages(diags)).toEqual([])
  })

  test('lambda 未知参数类型告警', async () => {
    const diags = await diagnostics(`
        f = [x: Foo -> x + 1]
    `)
    expect(messages(diags).join('\n')).toContain("未知类型 'Foo'")
  })

  test('lambda 与 apply 对象双向兼容（同像）', async () => {
    const diags = await diagnostics(`
        f = [x -> x + 1];
        f = { apply(x) { x + 1 } };
        f apply 1
    `)
    expect(messages(diags)).toEqual([])
  })

  test('apply 对象重新赋值为 lambda 无警告（同像）', async () => {
    const diags = await diagnostics(`
        f = { apply(x) { x + 1 } };
        f = [x -> x + 1];
        f apply 1
    `)
    expect(messages(diags)).toEqual([])
  })

  test('lambda 的 apply 调用参数检查生效', async () => {
    const diags = await diagnostics(`
        f = [x: number -> x + 1];
        f apply 'str'
    `)
    expect(messages(diags).join('\n')).toContain('调用参数不匹配')
  })

  test('lambda 的 apply 调用参数正确无警告', async () => {
    const diags = await diagnostics(`
        f = [x: number -> x + 1];
        f apply 42
    `)
    expect(messages(diags)).toEqual([])
  })

  test('lambda 传给需要 apply 方法的对象参数无告警', async () => {
    const diags = await diagnostics(`
        obj = { call(f) => f apply 42 };
        obj call [x -> x * 2]
    `)
    expect(messages(diags)).toEqual([])
  })
})

describe('字面量类型与可区分联合', () => {
  test('字面量类型解析', async () => {
    const diags = await diagnostics(`
        Circle #type { kind(): 'circle', radius: number };
        c: 'circle' | 'square' = 'circle';
        n: 1 | 2 | 3 = 2;
        b: true | false = true
    `)
    expect(messages(diags)).toEqual([])
  })

  test('字面量是基础类型的子类型', async () => {
    const diags = await diagnostics(`
        s: string = 'circle';
        n: number = 42;
        b: boolean = true
    `)
    expect(messages(diags)).toEqual([])
  })

  test('字面量不匹配告警', async () => {
    const diags = await diagnostics(`
        s: 'circle' = 'square'
    `)
    expect(messages(diags).join('\n')).toContain('类型不匹配')
  })

  test('判别方法返回字面量：对象字面量符合 typedef', async () => {
    const diags = await diagnostics(`
        Circle #type { kind(): 'circle', radius: number };
        c: Circle = { kind() { 'circle' }, radius() { 3 } }
    `)
    expect(messages(diags)).toEqual([])
  })

  test('判别方法返回非对应字面量告警', async () => {
    const diags = await diagnostics(`
        Circle #type { kind(): 'circle', radius: number };
        c: Circle = { kind() { 'square' }, radius() { 3 } }
    `)
    expect(messages(diags).join('\n')).toContain('类型不匹配')
  })

  test('guard 判别收窄：访问成员专属方法无告警', async () => {
    const diags = await diagnostics(`
        Circle #type { kind(): 'circle', radius: number };
        Square #type { kind(): 'square', side: number };
        area = {
            calc(s: Circle | Square) {
                #guard (s kind) == 'circle';
                (s radius) * (s radius)
            },
            calc(s: Circle | Square) {
                #guard (s kind) == 'square';
                (s side) * (s side)
            }
        };
        area calc { kind() { 'circle' }, radius() { 3 } }
    `)
    expect(messages(diags)).toEqual([])
  })

  test('guard != 判别收窄', async () => {
    const diags = await diagnostics(`
        Circle #type { kind(): 'circle', radius: number };
        Square #type { kind(): 'square', side: number };
        isSquare = {
            calc(s: Circle | Square) {
                #guard (s kind) != 'circle';
                s side
            }
        }
    `)
    expect(messages(diags)).toEqual([])
  })

  test('未判别直接访问成员专属方法告警', async () => {
    const diags = await diagnostics(`
        Circle #type { kind(): 'circle', radius: number };
        Square #type { kind(): 'square', side: number };
        bad = { calc(s: Circle | Square) { s radius } }
    `)
    expect(messages(diags).join('\n')).toContain("消息 'radius' 只定义在部分联合成员上")
  })

  test('联合的公共方法调用无告警', async () => {
    const diags = await diagnostics(`
        Circle #type { kind(): 'circle', radius: number };
        Square #type { kind(): 'square', side: number };
        getKind = { calc(s: Circle | Square) { s kind } }
    `)
    expect(messages(diags)).toEqual([])
  })
})

describe('泛型', () => {
  test('泛型 typedef 声明解析', async () => {
    const diags = await diagnostics(`
        Box #type<T> { get(): T, set(x: T) }
    `)
    expect(messages(diags)).toEqual([])
  })

  test('泛型实例化正确无警告', async () => {
    const diags = await diagnostics(`
        Box #type<T> { get(): T, set(x: T) };
        b: Box<number> = { get() { 42 }, set(x) { x } };
        b get
    `)
    expect(messages(diags)).toEqual([])
  })

  test('泛型实例化类型不符告警', async () => {
    const diags = await diagnostics(`
        Box #type<T> { get(): T };
        b: Box<number> = { get() { 'x' } }
    `)
    expect(messages(diags).join('\n')).toContain('类型不匹配')
  })

  test('泛型方法调用参数检查', async () => {
    const diags = await diagnostics(`
        Box #type<T> { get(): T, set(x: T) };
        b: Box<number> = { get() { 42 }, set(x) { x } };
        b set 'str'
    `)
    expect(messages(diags).join('\n')).toContain('调用参数不匹配')
  })

  test('泛型缺少类型参数告警', async () => {
    const diags = await diagnostics(`
        Box #type<T> { get(): T };
        b: Box = { get() { 1 } }
    `)
    expect(messages(diags).join('\n')).toContain('缺少类型参数')
  })

  test('多参数泛型', async () => {
    const diags = await diagnostics(`
        Pair #type<A, B> { first(): A, second(): B };
        p: Pair<number, string> = { first() { 1 }, second() { 'x' } }
    `)
    expect(messages(diags)).toEqual([])
  })

  test('泛型参数个数不匹配告警', async () => {
    const diags = await diagnostics(`
        Pair #type<A, B> { first(): A, second(): B };
        p: Pair<number> = { first() { 1 }, second() { 2 } }
    `)
    expect(messages(diags).join('\n')).toContain('类型参数')
  })

  test('非泛型类型带参数告警', async () => {
    const diags = await diagnostics(`
        Point #type { x: number };
        p: Point<number> = { x() { 1 } }
    `)
    expect(messages(diags).join('\n')).toContain('不是泛型')
  })

  test('嵌套泛型', async () => {
    const diags = await diagnostics(`
        Box #type<T> { get(): T };
        Pair #type<A, B> { first(): A, second(): B };
        inner = { get() { 1 } };
        p: Pair<Box<number>, string> = {
            first() { inner },
            second() { 'x' }
        }
    `)
    expect(messages(diags)).toEqual([])
  })

  test('泛型联合实例化', async () => {
    const diags = await diagnostics(`
        Circle #type { kind(): 'circle', radius: number };
        Square #type { kind(): 'square', side: number };
        box: 'circle' | 'square' = 'circle'
    `)
    expect(messages(diags)).toEqual([])
  })
})

describe('上下文类型回填', () => {
  test('泛型注解回填方法参数：方法体内直接使用无警告', async () => {
    const diags = await diagnostics(`
        Box #type<T> { get(): T, set(x: T) };
        b: Box<number> = { get() { 42 }, set(x) { x + 1 } }
    `)
    expect(messages(diags)).toEqual([])
  })

  test('回填后参数按声明类型检查', async () => {
    const diags = await diagnostics(`
        Box #type<T> { get(): T, set(x: T) };
        b: Box<number> = { get() { 42 }, set(x) { x = 'str' } }
    `)
    expect(messages(diags).join('\n')).toContain('重新赋值类型不匹配')
  })

  test('无注解对象不回填：参数保持 any', async () => {
    const diags = await diagnostics(`
        b = { set(x) { x = 'str' } }
    `)
    expect(messages(diags)).toEqual([])
  })

  test('非泛型注解也回填参数', async () => {
    const diags = await diagnostics(`
        Mapper #type { map(x: number): string };
        m: Mapper = { map(x) { x = 'str' } }
    `)
    expect(messages(diags).join('\n')).toContain('重新赋值类型不匹配')
  })

  test('显式参数注解优先于回填', async () => {
    const diags = await diagnostics(`
        Box #type<T> { get(): T, set(x: T) };
        b: Box<number> = { get() { 42 }, set(x: string) { x } }
    `)
    expect(messages(diags).join('\n')).toContain('类型不匹配')
  })
})

describe('回调实参回填', () => {
  test('匿名对象回调参数回填：方法体内直接使用无警告', async () => {
    const diags = await diagnostics(`
        Callback #type { apply(x: number) };
        Processor #type { run(cb: Callback) };
        p: Processor = { run(cb) { cb apply 1 } };
        p run { apply(x) { x * 2 } }
    `)
    expect(messages(diags)).toEqual([])
  })

  test('匿名对象回调参数回填：参数按声明类型检查', async () => {
    const diags = await diagnostics(`
        Callback #type { apply(x: number) };
        Processor #type { run(cb: Callback) };
        p: Processor = { run(cb) { cb apply 1 } };
        p run { apply(x) { x = 'str' } }
    `)
    expect(messages(diags).join('\n')).toContain('重新赋值类型不匹配')
  })

  test('lambda 回调参数回填', async () => {
    const diags = await diagnostics(`
        Callback #type { apply(x: number) };
        Processor #type { run(cb: Callback) };
        p: Processor = { run(cb) { cb apply 1 } };
        p run [x -> x + 1]
    `)
    expect(messages(diags)).toEqual([])
  })

  test('lambda 回调参数回填：参数按声明类型检查', async () => {
    const diags = await diagnostics(`
        Callback #type { apply(x: number) };
        Processor #type { run(cb: Callback) };
        p: Processor = { run(cb) { cb apply 1 } };
        p run [x -> x = 'str']
    `)
    expect(messages(diags).join('\n')).toContain('重新赋值类型不匹配')
  })

  test('泛型实例化的回调参数回填', async () => {
    const diags = await diagnostics(`
        Callback #type { apply(x: number) };
        Box #type<T> { forEach(cb: T) };
        b: Box<Callback> = { forEach(cb) { cb apply 1 } };
        b forEach { apply(x) { x * 2 } }
    `)
    expect(messages(diags)).toEqual([])
  })

  test('无回调上下文时不回填', async () => {
    const diags = await diagnostics(`
        n = { run(cb) { 1 } };
        n run { apply(x) { x = 'str' } }
    `)
    expect(messages(diags)).toEqual([])
  })
})

describe('跨模块 #import 类型', () => {
  // 每个用例用独立的模块 URI 加载，避免 parseHelper 重复注册同名文档。
  // 被导入文档必须解析到其 documentUri 对应路径，静态解析器才找得到。
  async function loadImport(
    name: string,
    source: string,
  ): Promise<void> {
    await parse(source, { documentUri: URI.file(`${name}.ooc`).toString() })
  }

  async function checkModule(
    uri: string,
    source: string,
  ): Promise<Diagnostic[]> {
    const doc = await parse(source, {
      documentUri: URI.file(uri).toString(),
      validation: true,
    })
    return doc.diagnostics ?? []
  }

  test('导入模块返回对象：类型可见，参数不匹配会告警（不再是 any）', async () => {
    await loadImport(
      'math',
      `{ add(a: number, b: number): number { a + b }, double(x: number): number { x * 2 } }`,
    )
    const diags = await checkModule(
      'demo.ooc',
      `math = #import 'math';
       result: number = math add 1 'x';
       result`,
    )
    expect(messages(diags).join('\n')).toContain('调用参数不匹配')
  })

  test('导入模块返回对象：参数正确无告警，返回类型参与赋值检查', async () => {
    await loadImport(
      'math2',
      `{ add(a: number, b: number): number { a + b } }`,
    )
    const diags = await checkModule(
      'demo2.ooc',
      `math = #import 'math2';
       result: number = math add 1 2;
       result`,
    )
    expect(messages(diags)).toEqual([])
  })

  test('被导入模块的 typedef 跨文档可见', async () => {
    await loadImport('types', `Point #type { x: number, y: number }`)
    const diags = await checkModule(
      'demo3.ooc',
      `types = #import 'types';
       p: Point = { x() { 1 }, y() { 2 } }`,
    )
    expect(messages(diags)).toEqual([])
  })

  test('被导入模块的 typedef 跨文档不匹配会告警', async () => {
    await loadImport('types2', `Point #type { x: number, y: number }`)
    const diags = await checkModule(
      'demo4.ooc',
      `types = #import 'types2';
       p: Point = { x() { 'bad' }, y() { 2 } }`,
    )
    expect(messages(diags).join('\n')).toContain('类型不匹配')
  })
})

describe('typedef 继承', () => {
  async function loadImport(
    name: string,
    source: string,
  ): Promise<void> {
    await parse(source, { documentUri: URI.file(`${name}.ooc`).toString() })
  }

  async function checkModule(
    uri: string,
    source: string,
  ): Promise<Diagnostic[]> {
    const doc = await parse(source, {
      documentUri: URI.file(uri).toString(),
      validation: true,
    })
    return doc.diagnostics ?? []
  }

  test("语法：'...' extends 子句可解析", async () => {
    const doc = await parse(`
        Animal #type { speak(): string };
        Dog #type { ...Animal, bark(): string }
    `)
    expect(doc.parseResult.parserErrors).toHaveLength(0)
  })

  test('单继承：继承父类型方法，自有方法覆盖同名', async () => {
    const diags = await diagnostics(`
        Animal #type { speak(): string, move(): number };
        Dog #type { ...Animal, bark(): string, move(): number };
        d: Dog = { speak() { 'wang' }, bark() { 'bow' }, move() { 4 } }
    `)
    expect(messages(diags)).toEqual([])
  })

  test('单继承：缺少父类型方法告警', async () => {
    const diags = await diagnostics(`
        Animal #type { speak(): string };
        Dog #type { ...Animal, bark(): string };
        d: Dog = { bark() { 'bow' } }
    `)
    expect(messages(diags).join('\n')).toContain('类型不匹配')
  })

  test('联合父类型：A 变成联合，只有部分分支的方法调用告警', async () => {
    const diags = await diagnostics(`
        Circle #type { kind(): 'circle', radius: number };
        Square #type { kind(): 'square', side: number };
        Shape #type { ...Circle | Square, m1(): number };
        use = { calc(s: Shape) { s radius } }
    `)
    expect(messages(diags).join('\n')).toContain("消息 'radius' 只定义在部分联合成员上")
  })

  test('联合父类型：公共方法无告警', async () => {
    const diags = await diagnostics(`
        Circle #type { kind(): 'circle', radius: number };
        Square #type { kind(): 'square', side: number };
        Shape #type { ...Circle | Square, m1(): number };
        use = { calc(s: Shape) { s kind } }
    `)
    expect(messages(diags)).toEqual([])
  })

  test('联合父类型：#guard 判别后可访问成员专属方法', async () => {
    const diags = await diagnostics(`
        Circle #type { kind(): 'circle', radius: number };
        Square #type { kind(): 'square', side: number };
        Shape #type { ...Circle | Square, m1(): number };
        area = {
            calc(s: Shape) {
                #guard (s kind) == 'circle';
                s radius
            }
        }
    `)
    expect(messages(diags)).toEqual([])
  })

  test('联合父类型：对象字面量匹配任一分支（含自有方法）', async () => {
    const diags = await diagnostics(`
        Circle #type { kind(): 'circle', radius: number };
        Square #type { kind(): 'square', side: number };
        Shape #type { ...Circle | Square, m1(): number };
        c: Shape = { kind() { 'circle' }, radius() { 3 }, m1() { 1 } };
        s: Shape = { kind() { 'square' }, side() { 4 }, m1() { 1 } }
    `)
    expect(messages(diags)).toEqual([])
  })

  test('联合父类型：对象字面量缺少自有方法告警', async () => {
    const diags = await diagnostics(`
        Circle #type { kind(): 'circle', radius: number };
        Square #type { kind(): 'square', side: number };
        Shape #type { ...Circle | Square, m1(): number };
        bad: Shape = { kind() { 'circle' }, radius() { 3 } }
    `)
    expect(messages(diags).join('\n')).toContain('类型不匹配')
  })

  test('泛型继承：实例化为对象', async () => {
    const diags = await diagnostics(`
        Named #type { name(): string };
        Box #type<T> { ...T, m1(): number };
        b: Box<Named> = { name() { 'box' }, m1() { 1 } }
    `)
    expect(messages(diags)).toEqual([])
  })

  test('泛型继承：实例化为联合', async () => {
    const diags = await diagnostics(`
        Circle #type { kind(): 'circle', radius: number };
        Square #type { kind(): 'square', side: number };
        Box #type<T> { ...T, m1(): number };
        use = { calc(s: Box<Circle | Square>) { s radius } }
    `)
    expect(messages(diags).join('\n')).toContain("消息 'radius' 只定义在部分联合成员上")
  })

  test('继承跨模块 typedef', async () => {
    await loadImport('base', `Animal #type { speak(): string }`)
    const diags = await checkModule(
      'demo5.ooc',
      `base = #import 'base';
       Dog #type { ...Animal, bark(): string };
       d: Dog = { speak() { 'wang' }, bark() { 'bow' } }`,
    )
    expect(messages(diags)).toEqual([])
  })
})
