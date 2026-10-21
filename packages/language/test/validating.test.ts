import { beforeAll, describe, expect, test } from './compat.js'
import { EmptyFileSystem, type LangiumDocument } from 'langium'
import { expandToString as s } from 'langium/generate'
import { parseHelper } from 'langium/test'
import type { Diagnostic } from 'vscode-languageserver-types'
import type { Model } from 'object-oriented-c-language'
import {
  createObjectOrientedCServices,
  isModel,
} from 'object-oriented-c-language'

let services: ReturnType<typeof createObjectOrientedCServices>
let parse: ReturnType<typeof parseHelper<Model>>
let document: LangiumDocument<Model> | undefined

beforeAll(async () => {
  services = createObjectOrientedCServices(EmptyFileSystem)
  const doParse = parseHelper<Model>(services.ObjectOrientedC)
  parse = (input: string) => doParse(input, { validation: true })
})

describe('Validating', () => {
  test('check no errors', async () => {
    document = await parse(`
            ab = 9;
        `)

    expect(
      checkDocumentValid(document) ||
        document?.diagnostics?.map(diagnosticToString)?.join('\n'),
    ).toHaveLength(0)
  })

  test('签名方法（无 body）必须声明返回类型', async () => {
    document = await parse(`
            obj = { f };
        `)

    const output =
      (checkDocumentValid(document) ||
        document?.diagnostics?.map(diagnosticToString)?.join('\n')) ||
      ''
    expect(output).toContain('必须声明返回类型')
  })

  test('签名方法（有返回类型）合法', async () => {
    document = await parse(`
            obj = { f: number };
        `)

    expect(
      checkDocumentValid(document) ||
        document?.diagnostics?.map(diagnosticToString)?.join('\n'),
    ).not.toContain('必须声明返回类型')
  })

  test('同名成员（bind 与 call）重复定义报错', async () => {
    document = await parse(`
            obj = {
                x = 1,
                x(v) => v
            };
        `)

    const output =
      checkDocumentValid(document) ||
      document?.diagnostics?.map(diagnosticToString)?.join('\n') ||
      ''
    expect(output).toContain('重复定义')
  })

  test('重复方法参数报错', async () => {
    document = await parse(`
            obj = {
                method(a, a) => a
            };
        `)

        const output =
          (checkDocumentValid(document) ||
            document?.diagnostics?.map(diagnosticToString)?.join('\n')) ||
          ''
        expect(output).toContain('参数里已经定义了')
  })

  test('同时报告多个错误', async () => {
    document = await parse(`
            obj = {
                method(a, a) { a }
            };
            x: number = 'str'
        `)

        const output =
          (checkDocumentValid(document) ||
            document?.diagnostics?.map(diagnosticToString)?.join('\n')) ||
          ''
        expect(output.length).toBeGreaterThan(0)
        expect(output).toContain('参数里已经定义了')
  })

  test('check valid method with parameters', async () => {
    document = await parse(`
            obj = {
                add(x, y) => x + y,
                mul(a, b) => a * b
            };
        `)

    expect(
      checkDocumentValid(document) ||
        document?.diagnostics?.map(diagnosticToString)?.join('\n'),
    ).toHaveLength(0)
  })

  test('复杂嵌套对象无类型告警', async () => {
    document = await parse(`
            config = {
                cache => {
                    ttl = 3600,
                    enabled = true
                },
                logging => {
                    level = 'info',
                    output = 'console'
                }
            };
        `)

    expect(
      checkDocumentValid(document) ||
        document?.diagnostics?.map(diagnosticToString)?.join('\n'),
    ).toHaveLength(0)
  })

  test('同名方法重复定义报 duplicateMethod', async () => {
    document = await parse(`
            obj = {
                fun(a) => a,
                fun(b) => b
            };
        `)

    const output =
      (checkDocumentValid(document) ||
        document?.diagnostics?.map(diagnosticToString)?.join('\n')) ||
      ''
    expect(output).toContain('重复定义')
  })

  test('单方法带 #guard 分支链不再报错', async () => {
    document = await parse(`
            obj = {
                fun(a) {
                    #guard a > 5;
                    a
                    #else;
                    a
                }
            };
        `)

    expect(
      checkDocumentValid(document) ||
        document?.diagnostics?.map(diagnosticToString)?.join('\n'),
    ).toHaveLength(0)
  })

  test('顶层重复声明报错', async () => {
    document = await parse(`
            x = 1;
            x = 2
        `)
    expect(outputOf(document)).toContain('同层作用域不允许重复声明')
  })

  test('顶层 #type 与赋值同名报错', async () => {
    document = await parse(`
            Point #type { x: number };
            Point = 1
        `)
    expect(outputOf(document)).toContain('同层作用域不允许重复声明')
  })

  test('方法体内重复声明报错', async () => {
    document = await parse(`
            obj = {
                fun {
                    x = 1;
                    x = 2;
                    x
                }
            };
        `)
    expect(outputOf(document)).toContain('同层作用域不允许重复声明')
  })

  test('#guard 分支各自独立作用域：跨分支同名不报错', async () => {
    document = await parse(`
            obj = {
                fun(a) {
                    #guard a;
                    x = 1;
                    x
                    #else;
                    x = 2;
                    x
                }
            };
        `)
    expect(outputOf(document)).not.toContain('同层作用域不允许重复声明')
  })

  test('自引用声明 x = x + 1 报错', async () => {
    document = await parse(`
            obj = {
                fun {
                    x = x + 1;
                    x
                }
            };
        `)
    expect(outputOf(document)).toContain('的初始化引用了自身')
  })

  test('消息名与声明同名不误报自引用', async () => {
    document = await parse(`
            obj = { x = 1 };
            x = obj x;
            x
        `)
    expect(outputOf(document)).not.toContain('初始化引用了自身')
  })

  test('lambda 体内引用自身允许（闭包延迟）', async () => {
    document = await parse(`
            f = [f];
            f $
        `)
    expect(outputOf(document)).not.toContain('初始化引用了自身')
  })

  test('对象方法体内引用自身允许', async () => {
    document = await parse(`
            obj = { get { obj } };
            obj get
        `)
    expect(outputOf(document)).not.toContain('初始化引用了自身')
  })

  test('绑定体引用自身允许（惰性读取）', async () => {
    document = await parse(`
            obj = { get = obj };
            obj get
        `)
    expect(outputOf(document)).not.toContain('初始化引用了自身')
  })

  test('顶层先使用后声明报暂时性死区', async () => {
    document = await parse(`
            x = y + 1;
            y = 2;
            x
        `)
    expect(outputOf(document)).toContain('暂时性死区')
  })

  test('方法体内先使用后声明报暂时性死区', async () => {
    document = await parse(`
            obj = {
                fun {
                    y;
                    y = 1;
                    y
                }
            };
            obj fun
        `)
    expect(outputOf(document)).toContain('暂时性死区')
  })

  test('内层后置声明遮蔽外层时仍报暂时性死区', async () => {
    document = await parse(`
            x = 1;
            obj = {
                fun {
                    x;
                    x = 2;
                    x
                }
            };
            obj fun
        `)
    expect(outputOf(document)).toContain('暂时性死区')
  })

  test('绑定块内先使用后声明报暂时性死区', async () => {
    document = await parse(`
            obj = {
                get = @{
                    a = b;
                    b = 1;
                    a
                }
            };
            obj get
        `)
    expect(outputOf(document)).toContain('暂时性死区')
  })

  test('lambda 可以引用外层稍后声明的名字', async () => {
    document = await parse(`
            f = [y];
            y = 1;
            f $
        `)
    expect(outputOf(document)).not.toContain('暂时性死区')
  })

  test('对象方法可以引用外层稍后声明的名字', async () => {
    document = await parse(`
            obj = { get { y } };
            y = 1;
            obj get
        `)
    expect(outputOf(document)).not.toContain('暂时性死区')
  })

  test('参数已初始化，不报暂时性死区', async () => {
    document = await parse(`
            obj = { fun(x) { x } };
            obj fun 1
        `)
    expect(outputOf(document)).not.toContain('暂时性死区')
  })

  test('参数与方法体内声明同名报错', async () => {
    document = await parse(`
            obj = {
                fun(a) {
                    a = 1;
                    a
                }
            };
        `)
    expect(outputOf(document)).toContain('同层作用域不允许重复声明')
  })

  test('不同作用域可以同名', async () => {
    document = await parse(`
            x = 1;
            obj = {
                get { x },
                fun(x) { x }
            };
            obj get;
            obj fun 2
        `)
    expect(outputOf(document)).not.toContain('同层作用域不允许重复声明')
  })

  test('绑定块内重复声明报错', async () => {
    document = await parse(`
            obj = {
                get = @{
                    x = 1;
                    x = 2;
                    x
                }
            };
        `)
    expect(outputOf(document)).toContain('同层作用域不允许重复声明')
  })

  test('lambda 参数与体内声明同名报错', async () => {
    document = await parse(`
            f = [x => x = 1]
        `)
    expect(outputOf(document)).toContain('同层作用域不允许重复声明')
  })

  test('不同 lambda 之间同名不报错', async () => {
    document = await parse(`
            f = [x => y = x; y];
            g = [x => y = x + 1; y]
        `)
    expect(outputOf(document)).not.toContain('同层作用域不允许重复声明')
  })
})

/** 诊断文本：解析器错误优先，其次逐条诊断（无诊断时为空串） */
function outputOf(document: LangiumDocument | undefined): string {
  return (
    checkDocumentValid(document as LangiumDocument) ||
    document?.diagnostics?.map(diagnosticToString)?.join('\n') ||
    ''
  )
}

function checkDocumentValid(document: LangiumDocument): string | undefined {
  return (
    (document.parseResult.parserErrors.length &&
      s`
        Parser errors:
          ${document.parseResult.parserErrors
            .map((e) => e.message)
            .join('\n  ')}
    `) ||
    (document.parseResult.value === undefined &&
      `ParseResult is 'undefined'.`) ||
    (!isModel(document.parseResult.value) &&
      `Root AST object is a ${document.parseResult.value.$type}, expected a 'Model'`) ||
    undefined
  )
}

function diagnosticToString(d: Diagnostic): string {
  return `[${d.range.start.line}:${d.range.start.character}..${d.range.end.line}:${d.range.end.character}]: ${d.message}`
}
