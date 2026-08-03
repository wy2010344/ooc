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

  test('原生类型属性读取', async () => {
    const result = await interpreter.interpret(`'abcdef' length`)
    expect(result).toBe(6)
  })

  test('原生类型方法执行', async () => {
    const result = await interpreter.interpret(`'abcdef' slice 1 3`)
    expect(result).toBe('bc')
  })

  test('原生类型属性设置', async () => {
    process.env._OOC_TEST_PROP = 'x'
    try {
      const result = await interpreter.interpret(`
            e = process env;
            e _OOC_TEST_PROP 42;
            e _OOC_TEST_PROP
        `)
      expect(result).toBe('42')
    } finally {
      delete process.env._OOC_TEST_PROP
    }
  })

  test('原生类型未绑定走 methodNotFound', async () => {
    await expect(
      interpreter.interpret(`Math _ooc_notexist_method`),
    ).rejects.toThrow('没有定义该方法')
  })

  test('自定义对象未绑定触发 methodNotFound 方法', async () => {
    const result = await interpreter.interpret(`
            obj = {
                methodNotFound(name) { 'fallback:' + name }
            };
            obj foo
        `)
    expect(result).toBe('fallback:foo')
  })
})
