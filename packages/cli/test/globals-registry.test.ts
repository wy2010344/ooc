// A5 注册表注入测试：createBridgeGlobalsTypes（language 内置 ∪ ooc-mve-bridge）
// 作 createTypeCheckAction 的注册表后，config.ooc 只列名的 globals
// 解析出真实类型（非 any）——与 extension/CLI 的注入同一链路。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EmptyFileSystem } from 'langium'
import {
  collectConfigGlobalsFromText,
  createObjectOrientedCServices,
} from 'object-oriented-c-language'
import { createBridgeGlobalsTypes } from 'ooc-mve-bridge/types'

const ALL_NAMES = [
  // language 内置
  'storage',
  'js',
  'delegate',
  'ObjectValue',
  'console',
  // ooc-mve-bridge 视图层
  'dom',
  'text',
  'html',
  'fc',
  'forEach',
  // ooc-mve-bridge 响应式
  'createSignal',
  'memo',
  'addEffect',
  'createContext',
]

test('createBridgeGlobalsTypes 合并 language 内置与桥接类型源（全部非 any）', () => {
  const registry = createBridgeGlobalsTypes()
  assert.ok(registry, '注册表应存在')
  for (const name of ALL_NAMES) {
    assert.ok(registry!.has(name), `注册表应含 ${name}`)
    assert.notEqual(registry!.get(name)!.kind, 'any', `${name} 不应是 any`)
  }
})

test('注入注册表后 config.ooc 只列名解析出真实类型（非 any）', () => {
  const registry = createBridgeGlobalsTypes()!
  const services = createObjectOrientedCServices(
    EmptyFileSystem,
    undefined,
    registry,
  ).ObjectOrientedC
  const globals = collectConfigGlobalsFromText(
    'config = { globals = { dom = dom, createSignal = createSignal, console = console } };\nconfig',
    services,
  )
  assert.ok(globals, '应收集到 globals')
  assert.equal(globals!.get('dom')?.kind, 'object')
  assert.equal(globals!.get('createSignal')?.kind, 'object')
  assert.equal(globals!.get('console')?.kind, 'object')
})
