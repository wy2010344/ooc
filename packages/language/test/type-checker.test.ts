import { beforeAll, describe, expect, test } from 'vitest'
import { EmptyFileSystem } from 'langium'
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
})
