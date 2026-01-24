import { test } from 'vitest'
import { EmptyFileSystem } from 'langium'
import { parseHelper } from 'langium/test'
import type { Model } from 'object-oriented-c-language'
import { createObjectOrientedCServices } from 'object-oriented-c-language'

test.skip('debug parse snippet', async () => {
  const services = createObjectOrientedCServices(EmptyFileSystem)
  const parse = parseHelper<Model>(services.ObjectOrientedC)
  const code = `
    myObj = {
      add(a b): a add b,
      sub(a b): a sub b
    };
  `
  const document = await parse(code)
  console.log(
    'parserErrors:',
    document.parseResult.parserErrors.map((e) => e.message),
  )
})
