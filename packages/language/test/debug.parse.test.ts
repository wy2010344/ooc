import { test } from 'vitest'
import { EmptyFileSystem } from 'langium'
import { parseHelper } from 'langium/test'
import type { OOCModel } from 'object-oriented-c-language'
import { createObjectOrientedCServices } from 'object-oriented-c-language'

test('debug parse snippet', async () => {
  const services = createObjectOrientedCServices(EmptyFileSystem)
  const parse = parseHelper<OOCModel>(services.ObjectOrientedC)
  const code = `
    myObj = {
      add(a b): a add b,
      sub(a b): a sub b
    };
  `
  const document = await parse(code)
  console.log(
    'parserErrors:',
    document.parseResult.parserErrors.map((e) => e.message)
  )
  const model = document.parseResult.value
  if (
    model &&
    model.items &&
    model.items[0] &&
    model.items[0].$type === 'VarDecl' &&
    (model.items[0] as any).value
  ) {
    const obj = (model.items[0] as any).value
    if (obj.items) {
      console.log('ObjLit items count:', obj.items.length)
      for (const it of obj.items) {
        console.log(
          'item:',
          it.name,
          'hasBody=',
          !!it.body,
          'hasProp=',
          !!it.prop
        )
      }
    } else {
      console.log('No items in object literal')
    }
  }
  // Print lexer tokens for inspection
  try {
    // @ts-ignore
    const tokens = document.parseResult.lexerReport.tokens
    console.log('Tokens:')
    for (const t of tokens) {
      console.log(t.tokenType?.name || t.name, JSON.stringify(t.image))
    }
  } catch (e) {
    console.log('No lexer tokens available')
  }
})
