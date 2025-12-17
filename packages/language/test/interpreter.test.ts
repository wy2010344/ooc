import { beforeAll, describe, expect, test } from 'vitest'
import { EmptyFileSystem } from 'langium'
import { parseHelper } from 'langium/test'
import type { OOCModel } from 'object-oriented-c-language'
import {
  createObjectOrientedCServices,
  executeOOC,
} from 'object-oriented-c-language'

let services: ReturnType<typeof createObjectOrientedCServices>
let parse: ReturnType<typeof parseHelper<OOCModel>>

beforeAll(async () => {
  services = createObjectOrientedCServices(EmptyFileSystem)
  parse = parseHelper<OOCModel>(services.ObjectOrientedC)
})

describe('OOC Interpreter', () => {
  test('interpret simple variable declaration', async () => {
    const document = await parse(`
            x = 42;
        `)

    if (document.parseResult.value) {
      const result = executeOOC(document.parseResult.value)
      expect(result).toBeDefined()
    }
  })

  test('interpret basic arithmetic operations', async () => {
    const document = await parse(`
            x = 10;
            y = 20;
            result = x add y;
        `)

    if (document.parseResult.value) {
      const result = executeOOC(document.parseResult.value)
      expect(result).toBeDefined()
    }
  })

  test('interpret object with methods', async () => {
    const document = await parse(`
            calc = {
                value: 42,
                add(n): value add n,
                double: value mul 2
            };
        `)

    if (document.parseResult.value) {
      const result = executeOOC(document.parseResult.value)
      expect(result).toBeDefined()
    }
  })

  test('interpret string operations', async () => {
    const document = await parse(`
            text = 'hello';
            len = text length;
        `)

    if (document.parseResult.value) {
      const result = executeOOC(document.parseResult.value)
      expect(result).toBeDefined()
    }
  })

  test('interpret boolean values', async () => {
    const document = await parse(`
            t = true;
            f = false;
        `)

    if (document.parseResult.value) {
      const result = executeOOC(document.parseResult.value)
      expect(result).toBeDefined()
    }
  })

  test('interpret union types', async () => {
    const document = await parse(`
            success = $ ok 100;
            error = $ fail 'error message';
        `)

    if (document.parseResult.value) {
      const result = executeOOC(document.parseResult.value)
      expect(result).toBeDefined()
    }
  })

  test('interpret method with multiple parameters', async () => {
    const document = await parse(`
            math = {
                add(a b): a add b,
                mul(a b): a mul b
            };
        `)

    if (document.parseResult.value) {
      const result = executeOOC(document.parseResult.value)
      expect(result).toBeDefined()
    }
  })

  test('interpret chained method calls', async () => {
    const document = await parse(`
            x = 5;
            y = x add 10 | mul 2;
        `)

    if (document.parseResult.value) {
      const result = executeOOC(document.parseResult.value)
      expect(result).toBeDefined()
    }
  })

  test('interpret nested objects', async () => {
    const document = await parse(`
            outer = {
                inner: {
                    value: 42
                }
            };
        `)

    if (document.parseResult.value) {
      const result = executeOOC(document.parseResult.value)
      expect(result).toBeDefined()
    }
  })

  test('interpret exported methods', async () => {
    const document = await parse(`
            export add(a b): a add b;
            export mul(a b): a mul b;
        `)

    if (document.parseResult.value) {
      const result = executeOOC(document.parseResult.value)
      expect(result).toBeDefined()
    }
  })

  test('multiple arithmetic operations', async () => {
    const document = await parse(`
            num = 10;
            result = num add 5 | mul 2 | sub 3;
        `)

    if (document.parseResult.value) {
      const result = executeOOC(document.parseResult.value)
      expect(result).toBeDefined()
    }
  })

  test('object with string concatenation', async () => {
    const document = await parse(`
            str = 'Hello';
            result = str add ' World';
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
            res = a gcd b;
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
            f = n factorial;
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
            s = lst sumList;
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
