import { describe, expect, test } from './compat.js'
import { EmptyFileSystem } from 'langium'
import { URI } from 'langium'
import { parseHelper } from 'langium/test'
import type { Model } from 'object-oriented-c-language'
import {
  collectConfigGlobalsFromText,
  createObjectOrientedCServices,
  coreBridgeGlobals,
  coreBridgeTypesSource,
  loadGlobalsTypesFromSource,
} from 'object-oriented-c-language'

/**
 * Route A 类型源 loader 测试：
 * 宿主包自持 .ooc 类型源 → loadGlobalsTypesFromSource 解析成 Map<name, TypeInfo>；
 * config.ooc 只列名的 globals 经注册表解析出真实类型（不再退化为 any）。
 */

// 内联一个桥接形状的类型源（等价于 ooc-mve-bridge 的 bridgeTypesSource 子集）
const SAMPLE_BRIDGE_SOURCE = `Component #type {
    class(props): Component,
    on(event): Component
};

dom = {
    div(props): Component,
    button(props): Component
};

text = {
    apply(content): Component
};

config = {
    globals = {
        dom = dom,
        text = text
    }
};

config
`

/** ObjectTypeInfo 的 methods 结构（测试只读名字/返回类型） */
interface MethodsOwner {
  kind: string
  methods: Map<string, Array<{ returns: { name?: string } }>>
}

describe('loadGlobalsTypesFromSource', () => {
  test('language 内置类型源：storage/js/delegate/ObjectValue 全部解析出来', () => {
    const globals = loadGlobalsTypesFromSource(coreBridgeTypesSource)
    expect(globals).toBeTypeOf('object')
    const storage = globals!.get('storage') as MethodsOwner
    expect(storage?.kind).toBe('object')
    // storage.ref 的返回类型应解析为 Ref（typedef 注册成功）
    expect(storage.methods.get('ref')?.[0].returns?.name).toBe('Ref')
    expect(globals!.has('js')).toBe(true)
    expect(globals!.has('delegate')).toBe(true)
    expect(globals!.has('ObjectValue')).toBe(true)
  })

  test('桥接形状类型源：dom 的标签方法是签名方法（Component 返回）', () => {
    const globals = loadGlobalsTypesFromSource(SAMPLE_BRIDGE_SOURCE)
    const dom = globals!.get('dom') as MethodsOwner
    expect(dom?.kind).toBe('object')
    expect(dom.methods.get('div')?.[0].returns?.name).toBe('Component')
    expect(globals!.get('text')).toBeTypeOf('object')
  })

  test('coreBridgeGlobals 快捷 loader 与手写等价', () => {
    const direct = loadGlobalsTypesFromSource(coreBridgeTypesSource)
    const shortcut = coreBridgeGlobals()
    expect(shortcut?.size).toBe(direct?.size)
    expect(shortcut?.has('storage')).toBe(true)
  })
})

describe('config.ooc 名字清单解析（Route A）', () => {
  const NAME_LIST = 'config = { globals = { dom = dom } };\nconfig'

  test('注入注册表后，globals 名字解析出真实类型（非 any）', () => {
    const registry = loadGlobalsTypesFromSource(SAMPLE_BRIDGE_SOURCE)!
    const services = createObjectOrientedCServices(
      EmptyFileSystem,
      undefined,
      registry,
    ).ObjectOrientedC
    const globals = collectConfigGlobalsFromText(NAME_LIST, services)
    expect((globals!.get('dom') as MethodsOwner)?.kind).toBe('object')
  })

  test('无注册表时退化为 any（不报错）', () => {
    const services = createObjectOrientedCServices(EmptyFileSystem)
      .ObjectOrientedC
    const globals = collectConfigGlobalsFromText(NAME_LIST, services)
    expect((globals!.get('dom') as MethodsOwner)?.kind).toBe('any')
  })

  test('注册表不被 per-doc applyGlobals 覆盖（#2 修复）', () => {
    const registry = loadGlobalsTypesFromSource(SAMPLE_BRIDGE_SOURCE)!
    const services = createObjectOrientedCServices(
      EmptyFileSystem,
      undefined,
      registry,
    ).ObjectOrientedC
    const validator = services.validation.ObjectOrientedCValidator
    // 模拟 ConfigAwareDocumentValidator：先注入项目 globals，再清空（无 config.ooc 目录）
    validator.applyGlobals(collectConfigGlobalsFromText(NAME_LIST, services))
    validator.applyGlobals(undefined)
    // 注册表仍在 → 后续 config.ooc 名字清单仍能解析出 dom
    const globals = collectConfigGlobalsFromText(NAME_LIST, services)
    expect((globals!.get('dom') as MethodsOwner)?.kind).toBe('object')
  })

  test('端到端：注册表注入后 dom div 消息调用无诊断', async () => {
    const registry = loadGlobalsTypesFromSource(SAMPLE_BRIDGE_SOURCE)!
    const services = createObjectOrientedCServices(
      EmptyFileSystem,
      undefined,
      registry,
    ).ObjectOrientedC
    const parse = parseHelper<Model>(services)
    const doc = await parse('dom div {}\n', {
      documentUri: URI.file('/proj/demo.ooc').toString(),
      validation: true,
    })
    expect(doc.diagnostics ?? []).toEqual([])
  })

  test('端到端：未知标签（宽泛 Proxy，非枚举名）无诊断、退化为 any', async () => {
    const registry = loadGlobalsTypesFromSource(SAMPLE_BRIDGE_SOURCE)!
    const services = createObjectOrientedCServices(
      EmptyFileSystem,
      undefined,
      registry,
    ).ObjectOrientedC
    const parse = parseHelper<Model>(services)
    const doc = await parse('dom customEl { class: 1 } (text apply 1)\n', {
      documentUri: URI.file('/proj/demo.ooc').toString(),
      validation: true,
    })
    // 未知标签类型静默（运行时由 JS Proxy 动态创建），不需要 methodNotFound
    expect(doc.diagnostics ?? []).toEqual([])
  })
})