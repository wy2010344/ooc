import { beforeAll, describe, expect, test } from 'vitest'
import { EmptyFileSystem } from 'langium'
import { createInterpretAction } from 'object-oriented-c-language'

let interpreter: ReturnType<typeof createInterpretAction>

beforeAll(async () => {
  interpreter = createInterpretAction(EmptyFileSystem)
})

describe('OOC Interpreter', () => {
  test('变量与算术', async () => {
    const result = await interpreter.interpret(`
            x = 42;
            y = 33;
            x + y
        `)
    expect(result).toBe(75)
  })

  test('对象方法调用', async () => {
    const result = await interpreter.interpret(`
            value = 42;
            calc = {
                add(n) => value + n,
                double = value * 2
            };
            calc double
        `)
    expect(result).toBe(84)
  })

  test('对象方法带参数', async () => {
    const result = await interpreter.interpret(`
            calc = {
                add(n) => n + 1
            };
            calc add 4
        `)
    expect(result).toBe(5)
  })

  test('字符串拼接', async () => {
    const result = await interpreter.interpret(`
            'hello' + ' world'
        `)
    expect(result).toBe('hello world')
  })

  test('布尔值', async () => {
    const result = await interpreter.interpret(`
            t = true;
            f = false;
            t
        `)
    expect(result).toBe(true)
  })

  test('嵌套对象', async () => {
    const result = await interpreter.interpret(`
            outer = {
                inner = {
                    value = 42
                }
            };
            outer inner / value
        `)
    expect(result).toBe(42)
  })

  test('#guard 分支', async () => {
    const result = await interpreter.interpret(`
            obj = {
                fun(a) { #guard a > 5; a }
            };
            obj fun 9
        `)
    expect(result).toBe(9)
  })

  test('剩余参数', async () => {
    const result = await interpreter.interpret(`
            obj = {
                apply(a, ...b) { b }
            };
            obj apply 1 2 3 4
        `)
    expect(result).toEqual([2, 3, 4])
  })

  test('继承调用父方法', async () => {
    const result = await interpreter.interpret(`
            animal = { speak() { "voice } };
            dog = { ...animal, bark() { "wang } };
            dog speak
        `)
    expect(result).toBe('voice')
  })

  test('继承覆盖父方法', async () => {
    const result = await interpreter.interpret(`
            animal = { speak() { "voice } };
            dog = { ...animal, speak() { "wang } };
            dog speak
        `)
    expect(result).toBe('wang')
  })

  test('父方法 this 访问父字段', async () => {
    const result = await interpreter.interpret(`
            base = { name = 'pet' };
            child = { ...base, greet() { this name } };
            child greet
        `)
    expect(result).toBe('pet')
  })

  test('JS 对象属性用 @ 访问', async () => {
    const result = await interpreter.interpret(`'abcdef' @length`)
    expect(result).toBe(6)
  })

  test('JS 对象属性当方法调用给出提示', async () => {
    await expect(interpreter.interpret(`'abcdef' length`)).rejects.toThrow(
      '属性，不是方法',
    )
  })
})
