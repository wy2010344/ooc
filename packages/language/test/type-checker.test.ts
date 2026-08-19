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
        data | x -> x + 1
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
        f = [x => x + 1];
        f apply 41
    `)
    expect(messages(diags)).toEqual([])
  })

  test('lambda 未知参数类型告警', async () => {
    const diags = await diagnostics(`
        f = [x: Foo => x + 1]
    `)
    expect(messages(diags).join('\n')).toContain("未知类型 'Foo'")
  })

  test('lambda 与 apply 对象双向兼容（同像）', async () => {
    const diags = await diagnostics(`
        f = [x => x + 1];
        f = { apply(x) { x + 1 } };
        f apply 1
    `)
    expect(messages(diags)).toEqual([])
  })

  test('apply 对象重新赋值为 lambda 无警告（同像）', async () => {
    const diags = await diagnostics(`
        f = { apply(x) { x + 1 } };
        f = [x => x + 1];
        f apply 1
    `)
    expect(messages(diags)).toEqual([])
  })

  test('lambda 的 apply 调用参数检查生效', async () => {
    const diags = await diagnostics(`
        f = [x: number => x + 1];
        f apply 'str'
    `)
    expect(messages(diags).join('\n')).toContain('调用参数不匹配')
  })

  test('lambda 的 apply 调用参数正确无警告', async () => {
    const diags = await diagnostics(`
        f = [x: number => x + 1];
        f apply 42
    `)
    expect(messages(diags)).toEqual([])
  })

  test('lambda 传给需要 apply 方法的对象参数无告警', async () => {
    const diags = await diagnostics(`
        obj = { call(f) => f apply 42 };
        obj call [x => x * 2]
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
        p run [x => x + 1]
    `)
    expect(messages(diags)).toEqual([])
  })

  test('lambda 回调参数回填：参数按声明类型检查', async () => {
    const diags = await diagnostics(`
        Callback #type { apply(x: number) };
        Processor #type { run(cb: Callback) };
        p: Processor = { run(cb) { cb apply 1 } };
        p run [x => x = 'str']
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

  test('命名空间访问：math#类型成员（混合在导出对象里）', async () => {
    await loadImport(
      'geom',
      `Circle #type { area(): number, radius(): number };
       { make(): Circle { { area() { 1 }, radius() { 2 } } } }`,
    )
    const diags = await checkModule(
      'ns-demo1.ooc',
      `geom = #import 'geom';
       c: geom#Circle = geom make;
       c`,
    )
    expect(messages(diags)).toEqual([])
  })

  test('命名空间访问：math#类型成员不匹配会告警', async () => {
    await loadImport('geom2', `Circle #type { area(): number }`)
    const diags = await checkModule(
      'ns-demo2.ooc',
      `geom = #import 'geom2';
       c: geom#Circle = { area() { 'x' } };
       c`,
    )
    expect(messages(diags).join('\n')).toContain('类型不匹配')
  })

  test('命名空间访问：math#方法名取返回类型', async () => {
    await loadImport('m3', `{ add(a: number, b: number): number { a + b } }`)
    const diags = await checkModule(
      'ns-demo3.ooc',
      `m = #import 'm3';
       x: m#add = 1;
       x`,
    )
    expect(messages(diags)).toEqual([])
  })

  test('命名空间访问：math#未知成员告警', async () => {
    await loadImport('m4', `{ add(a: number, b: number): number { a + b } }`)
    const diags = await checkModule(
      'ns-demo4.ooc',
      `m = #import 'm4';
       x: m#nope = 1;
       x`,
    )
    expect(messages(diags).join('\n')).toContain("类型 'm#nope' 不存在")
  })
})

describe('类型选择性导入', () => {
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

  test('选择性导入：语法解析不报错', async () => {
    const doc = await parse(`
        math = #import 'math' { Circle }
    `)
    expect(doc.parseResult.parserErrors).toHaveLength(0)
  })

  test('选择性导入：只导入指定类型', async () => {
    await loadImport('shapes', `
        Circle #type { radius(): number };
        Square #type { side(): number };
        { make(): Circle { { radius() { 1 } } } }
    `)
    const diags = await checkModule(
      'sel-import1.ooc',
      `shapes = #import 'shapes' { Circle };
       c: shapes#Circle = shapes make;
       c`,
    )
    expect(messages(diags)).toEqual([])
  })

  test('选择性导入：未导入的类型不可见', async () => {
    await loadImport('shapes2', `
        Circle #type { radius(): number };
        Square #type { side(): number };
        { make(): Circle { { radius() { 1 } } } }
    `)
    const diags = await checkModule(
      'sel-import2.ooc',
      `shapes = #import 'shapes2' { Circle };
       s: Square = { side() { 4 } }`,
    )
    expect(messages(diags).join('\n')).toContain('未知类型')
  })

  test('选择性导入：带别名导入', async () => {
    await loadImport('shapes3', `
        Circle #type { radius(): number };
        { make(): Circle { { radius() { 1 } } } }
    `)
    const diags = await checkModule(
      'sel-import3.ooc',
      `shapes = #import 'shapes3' { Circle as Circle2D };
       c: shapes#Circle2D = shapes make;
       c`,
    )
    expect(messages(diags)).toEqual([])
  })

  test('选择性导入：混合导入运行时对象 + 类型', async () => {
    await loadImport('m5', `
        Circle #type { radius(): number };
        { make(): Circle { { radius() { 1 } } } }
    `)
    const diags = await checkModule(
      'sel-import4.ooc',
      `m = #import 'm5' { Circle };
       c: m#Circle = m make;
       c`,
    )
    expect(messages(diags)).toEqual([])
  })

  test('选择性导入：导入多个类型', async () => {
    await loadImport('shapes4', `
        Circle #type { radius(): number };
        Square #type { side(): number };
        { circle(): Circle { { radius() { 1 } } }, square(): Square { { side() { 2 } } } }
    `)
    const diags = await checkModule(
      'sel-import5.ooc',
      `shapes = #import 'shapes4' { Circle, Square };
       c: shapes#Circle = shapes circle;
       s: shapes#Square = shapes square;
       c`,
    )
    expect(messages(diags)).toEqual([])
  })

  test('选择性导入：导入不存在的类型告警', async () => {
    await loadImport('shapes5', `
        Circle #type { radius(): number };
        { make(): Circle { { radius() { 1 } } } }
    `)
    const diags = await checkModule(
      'sel-import6.ooc',
      `shapes = #import 'shapes5' { Square };
       c: shapes#Circle = shapes make;
       c`,
    )
    expect(messages(diags).join('\n')).toContain('不存在')
  })
})

describe('方法层泛型', () => {
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

  test('方法泛型声明：map<T> 解析不报错', async () => {
    const doc = await parse(`
        list = {
            map<T>(f) { f }
        }
    `)
    expect(doc.parseResult.parserErrors).toHaveLength(0)
  })

  test('方法泛型：从实参推断返回类型，无告警', async () => {
    const diags = await diagnostics(`
        list = {
            map<T>(f: T): T { f }
        };
        r = list map 42;
        r
    `)
    expect(messages(diags)).toEqual([])
  })

  test('方法泛型：返回类型参与赋值检查（推断 T=number）', async () => {
    const diags = await diagnostics(`
        id = {
            identity<T>(x: T): T { x }
        };
        n: number = id identity 42;
        n
    `)
    expect(messages(diags)).toEqual([])
  })

  test('方法泛型：推断不出时退回 any，不误报参数不匹配', async () => {
    const diags = await diagnostics(`
        wrap = {
            make<T>(): T { nil }
        };
        w: string = wrap make;
        w
    `)
    expect(messages(diags).join('\n')).toContain('类型不匹配')
  })

  test('方法泛型：方法体内 T 可作为类型注解', async () => {
    const diags = await diagnostics(`
        box = {
            set<T>(x: T) { y: T = x }
        };
        box set 42
    `)
    expect(messages(diags)).toEqual([])
  })

  test('方法泛型：混合方法与类型成员（同像性）', async () => {
    await loadImport(
      'util',
      `Box #type<T> { value(): T };
       { make<T>(x: T): Box<T> { { value() { x } } } }`,
    )
    const diags = await checkModule(
      'demo9.ooc',
      `util = #import 'util';
       b: util#Box<number> = util make 42;
       b`,
    )
    expect(messages(diags)).toEqual([])
  })

  test('方法泛型：调用点显式类型参数解析', async () => {
    const doc = await parse(`
        list = { map<T>(f: T): T { f } };
        r = list map<number> 42
    `)
    expect(doc.parseResult.parserErrors).toHaveLength(0)
  })

  test('方法泛型：调用点显式类型参数正确无告警', async () => {
    const diags = await diagnostics(`
        list = { map<T>(f: T): T { f } };
        r: number = list map<number> 42
    `)
    expect(messages(diags)).toEqual([])
  })

  test('方法泛型：调用点显式类型参数错误告警', async () => {
    const diags = await diagnostics(`
        list = { map<T>(f: T): T { f } };
        r: string = list map<number> 'str'
    `)
    expect(messages(diags).join('\n')).toContain('调用参数不匹配')
  })

  test('方法泛型：调用点显式类型参数与推断等价', async () => {
    const diags1 = await diagnostics(`
        list = { map<T>(f: T): T { f } };
        r1: number = list map 42
    `)
    const diags2 = await diagnostics(`
        list = { map<T>(f: T): T { f } };
        r2: number = list map<number> 42
    `)
    expect(messages(diags1)).toEqual(messages(diags2))
  })

  test('方法泛型：调用点多类型参数', async () => {
    const diags = await diagnostics(`
        fn = { test<A, B>(a: A, b: B): A { a } };
        r: number = fn test<number, string> 42 'hello'
    `)
    expect(messages(diags)).toEqual([])
  })

  test('方法泛型：调用点类型参数个数不匹配告警', async () => {
    const diags = await diagnostics(`
        fn = { test<A, B>(a: A, b: B): A { a } };
        r = fn test<number> 42 'hello'
    `)
    expect(messages(diags).join('\n')).toContain('类型参数')
  })

  test('方法泛型：调用点显式参数类型不符告警', async () => {
    const diags = await diagnostics(`
        fn = { id<T>(x: T): T { x } };
        r = fn id<string> 42
    `)
    expect(messages(diags).join('\n')).toContain('调用参数不匹配')
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

describe('typedef 方法级泛型', () => {
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

  test('typedef 方法级泛型声明解析', async () => {
    const doc = await parse(`
        Container #type { wrap<T>(x: T): T }
    `)
    expect(doc.parseResult.parserErrors).toHaveLength(0)
  })

  test('typedef 方法级泛型：调用时从实参推断返回类型', async () => {
    const diags = await diagnostics(`
        Container #type { wrap<T>(x: T): T };
        c: Container = { wrap(x) { x } };
        r: number = c wrap 42;
        r
    `)
    expect(messages(diags)).toEqual([])
  })

  test('typedef 方法级泛型：推断结果参与赋值检查', async () => {
    const diags = await diagnostics(`
        Container #type { wrap<T>(x: T): T };
        c: Container = { wrap(x) { x } };
        s: string = c wrap 42;
        s
    `)
    expect(messages(diags).join('\n')).toContain('类型不匹配')
  })

  test('嵌套泛型推断：Box<T> 从实参对象方法签名反推 T', async () => {
    const diags = await diagnostics(`
        Box #type<T> { value(): T };
        list = {
            make<T>(b: Box<T>): T { b value }
        };
        r: number = list make { value() { 42 } };
        r
    `)
    expect(messages(diags)).toEqual([])
  })

  test('嵌套泛型推断：反推的 T 参与返回类型检查（回退 any 会漏报）', async () => {
    const diags = await diagnostics(`
        Box #type<T> { value(): T };
        list = {
            make<T>(b: Box<T>): T { b value }
        };
        n: number = list make { value() { 'x' } };
        n
    `)
    expect(messages(diags).join('\n')).toContain('类型不匹配')
  })

  test('泛型实例化保留方法级泛型签名', async () => {
    const diags = await diagnostics(`
        Box #type<T> { get(): T, map<U>(f: U): U };
        b: Box<number> = { get() { 42 }, map(f) { f } };
        r: string = b map 'x';
        r
    `)
    expect(messages(diags)).toEqual([])
  })

  test('方法级泛型与泛型 typedef 共存', async () => {
    const diags = await diagnostics(`
        Box #type<T> { get(): T };
        Util #type { open<U>(b: Box<U>): U };
        u: Util = { open(b) { b get } };
        n: number = u open { get() { 42 } };
        n
    `)
    expect(messages(diags)).toEqual([])
  })

  test('统一：导出对象类型成员与方法共存', async () => {
    await loadImport(
      'geom4',
      `Point #type { x: number };
       { origin(): Point { { x() { 0 } } } }`,
    )
    const diags = await checkModule(
      'ns-demo6.ooc',
      `g = #import 'geom4';
       p: g#Point = g origin;
       q: g#Point = { x() { 1 } };
       p x`,
    )
    expect(messages(diags)).toEqual([])
  })

  test('统一：导出对象携带类型成员，跨文档泛型访问可用', async () => {
    await loadImport(
      'geom5',
      `Box #type<T> { get(): T };
       { fresh<T>(x: T): Box<T> { { get() { x } } } }`,
    )
    const diags = await checkModule(
      'ns-demo7.ooc',
      `g = #import 'geom5';
       b: g#Box<string> = g fresh 'hi';
       b get`,
    )
    expect(messages(diags)).toEqual([])
  })
})
