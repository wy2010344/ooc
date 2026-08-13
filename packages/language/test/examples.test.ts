import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { EmptyFileSystem } from 'langium'
import {
  createInterpretAction,
  js,
  loop,
  sendMessage,
  storage,
} from 'object-oriented-c-language'
import { describe, expect, test } from './compat.js'

// 浏览器 demo 的自测案例（packages/example/src/ooc）作为单元测试回归，
// 宿主桥接用语言包导出的同一份 storage/loop/js，保证与 main.ts 行为一致。
const fixtures = join(
  import.meta.dirname,
  '..',
  '..',
  'example',
  'src',
  'ooc',
)

function runCase(file: string) {
  const src = readFileSync(join(fixtures, file), 'utf-8')
  const interpreter = createInterpretAction(EmptyFileSystem, {
    storage,
    loop,
    js,
  })
  return interpreter.interpret(src, file)
}

const expectedBinds: Record<string, Record<string, unknown>> = {
  'loop.ooc': {
    loopIterations: 5,
    loopRuns: 3,
    repeatSum: 10,
    repeatTouched: 0,
    sum_1_to_10: 55,
  },
  'js.ooc': { year: 2026, month: 0, called: 42 },
}

describe('browser demo 案例（宿主桥接注入）', () => {
  for (const [file, binds] of Object.entries(expectedBinds)) {
    test(`${file} 的绑定值正确`, async () => {
      const result = await runCase(file)
      for (const [key, value] of Object.entries(binds)) {
        expect(sendMessage(result as object, key, [])).toBe(value)
      }
    })
  }

  test('throw.ooc 通过 js throw 抛错中断执行', async () => {
    await expect(runCase('throw.ooc')).rejects.toThrow(/js 桥接抛错生效/)
  })
})
