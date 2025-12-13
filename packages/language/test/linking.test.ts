import { afterEach, beforeAll, describe, expect, test } from 'vitest'
import { EmptyFileSystem, type LangiumDocument } from 'langium'
import { expandToString as s } from 'langium/generate'
import { clearDocuments, parseHelper } from 'langium/test'
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
})

afterEach(async () => {
  document && clearDocuments(services.shared, [document])
})

describe('Linking tests', () => {
  test('basic binding and message passing', async () => {
    document = await parse(`
            a = {
                (hello name) {
                    name
                }
            };
            b = a hello 'world'
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
