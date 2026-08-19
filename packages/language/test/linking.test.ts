import { afterEach, beforeAll, describe, expect, test } from './compat.js'
import { EmptyFileSystem, type LangiumDocument } from 'langium'
import { expandToString as s } from 'langium/generate'
import { clearDocuments, parseHelper } from 'langium/test'
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

  // activate the following if your linking test requires elements from a built-in library, for example
  // await services.shared.workspace.WorkspaceManager.initializeWorkspace([]);
})

afterEach(async () => {
  document && clearDocuments(services.shared, [document])
})

describe('Linking tests', () => {
  test('linking of variables', async () => {
    document = await parse(`
            x = 10;
            y = 20;
        `)

    expect(
      // here we first check for validity of the parsed document object by means of the reusable function
      //  'checkDocumentValid()' to sort out (critical) typos first,
      // and then evaluate the cross references we're interested in by checking
      //  the referenced AST element as well as for a potential error message;
      checkDocumentValid(document) || 'Variables parsed successfully',
    ).toBe(s`
            Variables parsed successfully
        `)
  })

  test('reference to methods in objects', async () => {
    document = await parse(`
            calc = {
                add(a, b) => a add b,
                mul(a, b) => a mul b
            };
            result = calc add 5 |> mul 2;
        `)

    expect(checkDocumentValid(document)).toBeUndefined()
  })

  test('multiple object references in chain', async () => {
    document = await parse(`
            obj1 = {
                method1() => 10
            };
            obj2 = {
                method2() => 20
            };
            result = obj1 method1;
        `)

    expect(checkDocumentValid(document)).toBeUndefined()
  })

  test('nested object references', async () => {
    document = await parse(`
            outer = {
                inner() => {
                    value() => 42
                }
            };
            x = outer inner;
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
      `Root AST object is a ${document.parseResult.value.$type}, expected a 'OOCModel'.`) ||
    undefined
  )
}
