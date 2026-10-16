// member-lint：零参成员返回纯字面量必须写 '='（constMethodBody，error 级）。
import { beforeAll, describe, expect, test } from './compat.js'
import { EmptyFileSystem } from 'langium'
import { parseHelper } from 'langium/test'
import type { Diagnostic } from 'vscode-languageserver-types'
import type { Model } from 'object-oriented-c-language'
import { createObjectOrientedCServices } from 'object-oriented-c-language'

let parse: ReturnType<typeof parseHelper<Model>>

beforeAll(async () => {
  const services = createObjectOrientedCServices(EmptyFileSystem)
  parse = parseHelper<Model>(services.ObjectOrientedC)
})

async function messages(input: string): Promise<string[]> {
  const doc = await parse(input, { validation: true })
  return (doc.diagnostics ?? []).map((d: Diagnostic) => d.message)
}

describe('零参成员返回字面量必须用 = 常量绑定', () => {
  test('{ } 方法体返回字符串 → error 并给出改写建议', async () => {
    const msgs = await messages(`obj = { kind { 'circle' } };`)
    expect(msgs.join('\n')).toContain("零参成员 'kind' 只返回常量")
    expect(msgs.join('\n')).toContain("kind = 'circle'")
  })

  test('=> 单行返回字面量同样禁止', async () => {
    const msgs = await messages(`obj = { kind => 'circle' };`)
    expect(msgs.join('\n')).toContain("零参成员 'kind' 只返回常量")
  })

  test('数字 / bool / nil 字面量都报', async () => {
    const msgs = await messages(
      `obj = { n { 42 }, b { true }, z { nil } };`,
    )
    const hits = msgs.filter((m) => m.includes('只返回常量'))
    expect(hits.length).toBe(3)
  })

  test('= 常量绑定是推荐写法，不报', async () => {
    const msgs = await messages(`obj = { kind = 'circle' };`)
    expect(msgs.join('\n')).not.toContain('只返回常量')
  })

  test('带参方法返回字面量不报（无法改写成 =）', async () => {
    const msgs = await messages(`obj = { f(a) { 'x' } };`)
    expect(msgs.join('\n')).not.toContain('只返回常量')
  })

  test('带泛型零参成员不报（= 不支持泛型）', async () => {
    const msgs = await messages(`obj = { get<T> { 'x' } };`)
    expect(msgs.join('\n')).not.toContain('只返回常量')
  })

  test('多语句体不报（不是只返回常量）', async () => {
    const msgs = await messages(`obj = { m { t = 1; 'x' } };`)
    expect(msgs.join('\n')).not.toContain('只返回常量')
  })

  test('非字面量表达式不报', async () => {
    const msgs = await messages(`obj = { d { x + 1 } };`)
    expect(msgs.join('\n')).not.toContain('只返回常量')
  })

  test('#guard 分支体不报', async () => {
    const msgs = await messages(
      `obj = { m => #guard x; 'y' #else; 'z' };`,
    )
    expect(msgs.join('\n')).not.toContain('只返回常量')
  })

  test('返回对象/lambda 不报（每次读取是新引用，改写会共享引用）', async () => {
    const msgs = await messages(
      `obj = { mk { { a = 1 } }, h { [x => x] } };`,
    )
    expect(msgs.join('\n')).not.toContain('只返回常量')
  })
})
