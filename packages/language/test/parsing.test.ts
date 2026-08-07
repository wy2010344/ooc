import { beforeAll, describe, expect, test } from 'vitest'
import { EmptyFileSystem, type LangiumDocument } from 'langium'
import { expandToString as s } from 'langium/generate'
import { parseHelper } from 'langium/test'
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
  parse = parseHelper<Model>(services.ObjectOrientedC)
})

describe('Parsing tests', () => {
  test('parse simple OOCModel', async () => {
    document = await parse(`
            ab = 9;
            bc = 99;
        `)
    expect(checkDocumentValid(document)).toBeUndefined()
  })

  test('parse nested object with methods', async () => {
    document = await parse(`
            myObj = {
                add(a, b) => a + b,
                sub(a, b) => a - b
            };
        `)
    expect(checkDocumentValid(document)).toBeUndefined()
  })

  test('parse pipe with named expression', async () => {
    document = await parse(`
            result = 'hello' length | x => x + 5;
        `)
    expect(checkDocumentValid(document)).toBeUndefined()
  })

  test('parse object with mixed method and property definitions', async () => {
    document = await parse(`
            calc = {
                value = 42,
                getValue() => value,
                add(x) => value + x
            };
        `)
    expect(checkDocumentValid(document)).toBeUndefined()
  })

  test('parse lambda expressions', async () => {
    document = await parse(`
            f1 = [x -> x + 1];
            f2 = [a, b -> a + b];
            f3 = [x -> y = x + 1; y * 2];
            f4 = [42];
            f5 = [n * 21];
            f6 = [x: number -> x * 2];
        `)
    expect(checkDocumentValid(document)).toBeUndefined()
  })

  test('parse #import 语句', async () => {
    document = await parse(`
            math = '#import' 'math-lib';
            helper = '#import' 'helper-lib';
        `)
    expect(checkDocumentValid(document)).toBeUndefined()
  })

  test('parse #type 类型别名', async () => {
    document = await parse(`
            Point #type {
                x: number,
                y: number
            };
        `)
    expect(checkDocumentValid(document)).toBeUndefined()
  })

  test('parse complex nested pipe with multiple arguments', async () => {
    document = await parse(`
            x = obj method1 10 20 / method2 30 / method3;
        `)
    expect(checkDocumentValid(document)).toBeUndefined()
  })

  test('parse boolean and numeric literals', async () => {
    document = await parse(`
            t = true;
            f = false;
            i = 42;
            fl = 3.14;
            s = 'string';
        `)
    expect(checkDocumentValid(document)).toBeUndefined()
  })

  test('parse parenthesized expressions', async () => {
    document = await parse(`
            result = (x + y) + a - b;
        `)
    expect(checkDocumentValid(document)).toBeUndefined()
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
