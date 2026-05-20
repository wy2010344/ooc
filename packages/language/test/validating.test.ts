import { beforeAll, describe, expect, test } from 'vitest'
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

  // activate the following if your linking test requires elements from a built-in library, for example
  // await services.shared.workspace.WorkspaceManager.initializeWorkspace([]);
})

describe('Validating', () => {
  test('check no errors', async () => {
    document = await parse(`
            ab = 9;
        `)

    expect(
      // here we first check for validity of the parsed document object by means of the reusable function
      //  'checkDocumentValid()' to sort out (critical) typos first,
      // and then evaluate the diagnostics by converting them into human readable strings;
      // note that 'toHaveLength()' works for arrays and strings alike ;-)
      checkDocumentValid(document) ||
        document?.diagnostics?.map(diagnosticToString)?.join('\n'),
    ).toHaveLength(0)
  })

  test('check duplicate object members validation', async () => {
    document = await parse(`
            obj = {
                x => 10,
                x => 20
            };
        `)

    expect(
      checkDocumentValid(document) ||
        document?.diagnostics?.map(diagnosticToString)?.join('\n'),
    ).toEqual(expect.stringContaining('Duplicate member name: x'))
  })

  test('check duplicate export validation', async () => {
    document = await parse(`
            export x = 10;
            export x = 20;
        `)

    expect(
      checkDocumentValid(document) ||
        document?.diagnostics?.map(diagnosticToString)?.join('\n'),
    ).toEqual(expect.stringContaining('Duplicate export'))
  })

  test('check duplicate import validation', async () => {
    document = await parse(`
            import lib 'math';
            import lib 'another';
        `)

    expect(
      checkDocumentValid(document) ||
        document?.diagnostics?.map(diagnosticToString)?.join('\n'),
    ).toEqual(expect.stringContaining('Duplicate import'))
  })

  test('check duplicate method parameters', async () => {
    document = await parse(`
            obj = {
                method(a, a) => a add a
            };
        `)

    const validationResult = checkDocumentValid(document)
    const diagnosticsStr =
      document?.diagnostics?.map(diagnosticToString)?.join('\n') || ''
    const output = validationResult || diagnosticsStr

    expect(output).toEqual(expect.stringContaining('Duplicate parameter'))
  })

  test('check uppercase variable name warning', async () => {
    document = await parse(`
            X = 10;
        `)

    expect(
      checkDocumentValid(document) ||
        document?.diagnostics?.map(diagnosticToString)?.join('\n'),
    ).toEqual(expect.stringContaining('lowercase'))
  })

  test('check valid lowercase variable names', async () => {
    document = await parse(`
            x = 10;
            myVar = 20;
            _private = 30;
        `)

    expect(
      checkDocumentValid(document) ||
        document?.diagnostics?.map(diagnosticToString)?.join('\n'),
    ).not.toContain('lowercase')
  })

  test('check multiple errors are reported', async () => {
    document = await parse(`
            X = 10;
            obj = {
                a => 1,
                a => 2
            };
        `)

    const diagnosticText =
      checkDocumentValid(document) ||
      document?.diagnostics?.map(diagnosticToString)?.join('\n')

    // Should have at least warnings or errors
    expect(diagnosticText?.length).toBeGreaterThan(0)
  })

  test('check valid method with parameters', async () => {
    document = await parse(`
            obj = {
                add(x, y) => x add y,
                mul(a, b) => a mul b
            };
        `)

    expect(
      checkDocumentValid(document) ||
        document?.diagnostics?.map(diagnosticToString)?.join('\n'),
    ).toHaveLength(0)
  })

  test('check complex nested object validation', async () => {
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
