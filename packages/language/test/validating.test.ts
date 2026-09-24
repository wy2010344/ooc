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
            obj = { f() };
        `)

    const output =
      (checkDocumentValid(document) ||
        document?.diagnostics?.map(diagnosticToString)?.join('\n')) ||
      ''
    expect(output).toContain('必须声明返回类型')
  })

  test('签名方法（有返回类型）合法', async () => {
    document = await parse(`
            obj = { f(): number };
        `)

    expect(
      checkDocumentValid(document) ||
        document?.diagnostics?.map(diagnosticToString)?.join('\n'),
    ).not.toContain('必须声明返回类型')
  })

  test('同名方法重载不报重复错误', async () => {
    document = await parse(`
            obj = {
                fun(a) { a },
                fun(a, b) { a }
            };
        `)

    expect(
      checkDocumentValid(document) ||
        document?.diagnostics?.map(diagnosticToString)?.join('\n'),
    ).not.toContain('已经定义了')
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
                cache() => {
                    ttl() => 3600,
                    enabled() => true
                },
                logging() => {
                    level() => 'info',
                    output() => 'console'
                }
            };
        `)

    expect(
      checkDocumentValid(document) ||
        document?.diagnostics?.map(diagnosticToString)?.join('\n'),
    ).toHaveLength(0)
  })

  test('单方法 guard 报 guardOnlyInOverload', async () => {
    document = await parse(`
            obj = {
                fun(a) { #guard a > 5; a }
            };
        `)

    const output =
      (checkDocumentValid(document) ||
        document?.diagnostics?.map(diagnosticToString)?.join('\n')) ||
      ''
    expect(output).toContain('guard')
  })

  test('重载组末尾分支带 guard 报 guardOnTrailingBranch', async () => {
    document = await parse(`
            obj = {
                fun(a) { #guard a > 5; a },
                fun(a) { #guard a < 5; a }
            };
        `)

    const output =
      (checkDocumentValid(document) ||
        document?.diagnostics?.map(diagnosticToString)?.join('\n')) ||
      ''
    expect(output).toContain('guard')
  })

  test('重载组末尾无 guard 兜底合法', async () => {
    document = await parse(`
            obj = {
                fun(a) { #guard a > 5; a },
                fun(a) { a }
            };
        `)

    expect(
      checkDocumentValid(document) ||
        document?.diagnostics?.map(diagnosticToString)?.join('\n'),
    ).toHaveLength(0)
  })

  test('同名重载不相邻报 overloadNotAdjacent', async () => {
    document = await parse(`
            obj = {
                fun(a) { a },
                bar(a) { a },
                fun(a, b) { a }
            };
        `)

    const output =
      (checkDocumentValid(document) ||
        document?.diagnostics?.map(diagnosticToString)?.join('\n')) ||
      ''
    expect(output).toContain('相邻')
  })

  test('类/实例方法相邻重载合法', async () => {
    document = await parse(`
            C = #classDef {} {
                fun(a) { a },
                fun(a, b) { a }
            };
        `)

    expect(
      checkDocumentValid(document) ||
        document?.diagnostics?.map(diagnosticToString)?.join('\n'),
    ).toHaveLength(0)
  })
})

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
