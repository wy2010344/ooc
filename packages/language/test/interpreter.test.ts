import { beforeAll, describe, expect, test } from 'vitest'
import { EmptyFileSystem } from 'langium'
import { createInterpretAction } from 'object-oriented-c-language'

let interpreter: ReturnType<typeof createInterpretAction>

beforeAll(async () => {
  interpreter = createInterpretAction(EmptyFileSystem)
})

describe('OOC Interpreter', () => {
  test('interpret simple variable declaration', async () => {
    const result = await interpreter.interpret(`
            x = 42;
            y = 33;
            x add y
        `)

    expect(result).toBeDefined()
  })

  test('interpret object with methods', async () => {
    const result = await interpreter.interpret(`
            value = 42;
            calc = {
                add(n) => value add n,
                double = value mul 2
            };
            calc double / add 8
        `)

    expect(result).toBeDefined()
  })

  test('interpret string operations', async () => {
    const result = await interpreter.interpret(`
            text = 'hello';
            JSAttr get text "length / add 9
        `)

    expect(result).toBeDefined()
  })

  test('interpret boolean values', async () => {
    const result = await interpreter.interpret(`
            t = true;
            f = false;
            t
        `)
    expect(result).toBeDefined()
  })

  test('interpret nested objects', async () => {
    const result = await interpreter.interpret(`
            outer = {
                inner = {
                    value = 42
                }
            };
            outer
        `)
    expect(result).toBeDefined()
  })

  test('interpret exported methods', async () => {
    const result = await interpreter.interpret(`
            add = {add(a b) => a add b};
            add
        `)
    expect(result).toBeDefined()
  })

  test('multiple arithmetic operations', async () => {
    const result = await interpreter.interpret(`
            num = 10;
            num add 5
        `)
    expect(result).toBeDefined()
  })

  test('object with string concatenation', async () => {
    const result = await interpreter.interpret(`
            str = 'Hello';
            str
        `)
    expect(result).toBeDefined()
  })

  test('bridge gcd builtin', async () => {
    const result = await interpreter.interpret(`
            a = 48;
            b = 18;
            a gcd b
        `)

    expect(result).toBe(6)
  })

  test('bridge factorial builtin', async () => {
    const result = await interpreter.interpret(`
            n = 6;
            n factorial
        `)

    expect(result).toBe(720)
  })

  test('bridge sumList builtin for union list', async () => {
    const result = await interpreter.interpret(`
            lst = $cons 1 $cons 2 $cons 3 $nil;
            lst sumList
        `)
    expect(result).toBeDefined()
  })
})
