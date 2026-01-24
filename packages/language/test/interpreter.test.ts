import { beforeAll, describe, expect, test } from 'vitest'
import { EmptyFileSystem } from 'langium'
import { parseHelper } from 'langium/test'
import type { Model } from 'object-oriented-c-language'
import {
  createObjectOrientedCServices,
  executeOOC,
} from 'object-oriented-c-language'

let services: ReturnType<typeof createObjectOrientedCServices>
let parse: ReturnType<typeof parseHelper<Model>>

beforeAll(async () => {
  services = createObjectOrientedCServices(EmptyFileSystem)
  parse = parseHelper<Model>(services.ObjectOrientedC)
})

describe('OOC Interpreter', () => {
  test('interpret simple variable declaration', async () => {
    const document = await parse(`
            x = 42;
            y = 33;
            x add y
        `)

    if (document.parseResult.value) {
      console.log(document.parseResult.parserErrors)
      const result = executeOOC(document.parseResult.value)
      console.log(result)
      expect(result).toBeDefined()
    }
  })

  test('interpret object with methods', async () => {
    const document = await parse(`
            value = 42;
            calc = {
                add(n) => value add n,
                double = value mul 2
            };
            calc double / add 8
        `)

    if (document.parseResult.value) {
      console.log(document.parseResult.parserErrors)
      const result = executeOOC(document.parseResult.value)
      console.log(result)
      expect(result).toBeDefined()
    }
  })

  test('interpret string operations', async () => {
    const document = await parse(`
            text = 'hello';
            JSAttr get text "length / add 9
        `)

    if (document.parseResult.value) {
      const result = executeOOC(document.parseResult.value)
      console.log(result, document.parseResult.lexerErrors)
      expect(result).toBeDefined()
    }
  })

  test('interpret boolean values', async () => {
    const document = await parse(`
            t = true;
            f = false;
            t
        `)

    if (document.parseResult.value) {
      const result = executeOOC(document.parseResult.value)
      console.log(result)
      expect(result).toBeDefined()
    }
  })

  test('interpret nested objects', async () => {
    const document = await parse(`
            outer = {
                inner = {
                    value = 42
                }
            };
            outer
        `)

    if (document.parseResult.value) {
      const result = executeOOC(document.parseResult.value)
      expect(result).toBeDefined()
    }
  })

  test('interpret exported methods', async () => {
    const document = await parse(`
            add = {add(a b) => a add b};
            add
        `)

    if (document.parseResult.value) {
      const result = executeOOC(document.parseResult.value)
      expect(result).toBeDefined()
    }
  })

  test('multiple arithmetic operations', async () => {
    const document = await parse(`
            num = 10;
            num add 5
        `)

    if (document.parseResult.value) {
      const result = executeOOC(document.parseResult.value)
      expect(result).toBeDefined()
    }
  })

  test('object with string concatenation', async () => {
    const document = await parse(`
            str = 'Hello';
            str
        `)

    if (document.parseResult.value) {
      const result = executeOOC(document.parseResult.value)
      expect(result).toBeDefined()
    }
  })

  test('bridge gcd builtin', async () => {
    const document = await parse(`
            a = 48;
            b = 18;
            a gcd b
        `)

    if (document.parseResult.value) {
      const out = executeOOC(document.parseResult.value)
      const last = Array.isArray(out) ? out[out.length - 1] : out
      expect(last).toBeDefined()
      expect(last.$type).toBe('number')
      expect(last.value).toBe(6)
    }
  })

  test('bridge factorial builtin', async () => {
    const document = await parse(`
            n = 6;
            n factorial
        `)

    if (document.parseResult.value) {
      const out = executeOOC(document.parseResult.value)
      const last = Array.isArray(out) ? out[out.length - 1] : out
      expect(last).toBeDefined()
      expect(last.$type).toBe('number')
      expect(last.value).toBe(720)
    }
  })

  test('bridge sumList builtin for union list', async () => {
    const document = await parse(`
            lst = $cons 1 $cons 2 $cons 3 $nil;
            lst sumList
        `)

    if (document.parseResult.value) {
      const out = executeOOC(document.parseResult.value)
      const last = Array.isArray(out) ? out[out.length - 1] : out
      expect(last).toBeDefined()
      expect(last.$type).toBe('number')
      expect(last.value).toBe(6)
    }
  })
})
