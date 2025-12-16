import { beforeAll, describe, expect, test } from 'vitest'
import { EmptyFileSystem, type LangiumDocument } from 'langium'
import { expandToString as s } from 'langium/generate'
import { parseHelper } from 'langium/test'
import type { OOCModel } from 'object-oriented-c-language'
import {
  createObjectOrientedCServices,
  isOOCModel,
} from 'object-oriented-c-language'

let services: ReturnType<typeof createObjectOrientedCServices>
let parse: ReturnType<typeof parseHelper<OOCModel>>
let document: LangiumDocument<OOCModel> | undefined

beforeAll(async () => {
  services = createObjectOrientedCServices(EmptyFileSystem)
  parse = parseHelper<OOCModel>(services.ObjectOrientedC)

  // activate the following if your linking test requires elements from a built-in library, for example
  // await services.shared.workspace.WorkspaceManager.initializeWorkspace([]);
})

describe('Parsing tests', () => {
  test('parse simple OOCModel', async () => {
    document = await parse(`
            ab = 9;
            bc := 99;
        `)

    // check for absence of parser errors the classic way:
    //  deactivated, find a much more human readable way below!
    // expect(document.parseResult.parserErrors).toHaveLength(0);

    expect(
      // here we use a (tagged) template expression to create a human readable representation
      //  of the AST part we are interested in and that is to be compared to our expectation;
      // prior to the tagged template expression we check for validity of the parsed document object
      //  by means of the reusable function 'checkDocumentValid()' to sort out (critical) typos first;
      checkDocumentValid(document) ||
        s`
                Items parsed successfully
            `
    ).toBe(s`
            Items parsed successfully
        `)
  })

  test('parse nested object with methods', async () => {
    document = await parse(`
            myObj = {
                add(a b): a add b,
                sub(a b): a sub b
            };
        `)

    expect(checkDocumentValid(document)).toBeUndefined()
  })

  test('parse complex message chain with pipes', async () => {
    document = await parse(`
            result = 'hello' length | add 5 | mul 2;
        `)

    expect(checkDocumentValid(document)).toBeUndefined()
  })

  test('parse object with mixed method and property definitions', async () => {
    document = await parse(`
            calc = {
                value: 42,
                getValue: value,
                add(x): value add x,
                sub(x): value sub x
            };
        `)

    expect(checkDocumentValid(document)).toBeUndefined()
  })

  test('parse async method with @ notation', async () => {
    document = await parse(`
            asyncObj = {
                fetch(url)@: import of url @await
            };
        `)

    expect(checkDocumentValid(document)).toBeUndefined()
  })

  test('parse union type construction', async () => {
    document = await parse(`
            success = $ ok 100;
            error = $ fail 'something wrong';
        `)

    expect(checkDocumentValid(document)).toBeUndefined()
  })

  test('parse import and export statements', async () => {
    document = await parse(`
            import math 'math-lib';
            export add(a b): a add b;
            export result = 10;
        `)

    expect(checkDocumentValid(document)).toBeUndefined()
  })

  test('parse complex nested pipe with multiple arguments', async () => {
    document = await parse(`
            x = obj method1 10 20 | method2 30 | method3;
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
            result = (x add y) mul (a sub b);
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
    (!isOOCModel(document.parseResult.value) &&
      `Root AST object is a ${document.parseResult.value.$type}, expected a 'OOCModel'.`) ||
    undefined
  )
}
