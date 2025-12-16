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

/**
 *
 */
describe('Parsing tests', () => {
  test('parse simple OOCModel with bindings and objects', async () => {
    document = await parse(`     
            // Assignment
            counter =: result ;
            
            // Pipe operations
            'abcdef' slice 1 4 | startsWith 'b';
              // Object definition

            xx=$ abc 98 'sss';
            obj = {
                (increment x) {
                    x add 1
                }
                (greet name) {
                    'Hello, ' contact name
                }
            };
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
