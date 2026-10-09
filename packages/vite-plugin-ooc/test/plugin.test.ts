// vite-plugin-ooc 单元测试：直接调用插件 hook（不启动 vite，保证 Termux 可用）。
// 覆盖：.ooc transform 吐纯 JS、#import 相对/包/.ts 编译成真 ES import、虚拟 runtime 模块。
import { test } from 'node:test'
import * as path from 'node:path'
import { oocPlugin, OOC_RUNTIME_VIRTUAL_ID } from 'vite-plugin-ooc'
import { modelToTs } from 'object-oriented-c-cli'
import { createObjectOrientedCServices } from 'object-oriented-c-language'
import { URI } from 'langium'
import { NodeFileSystem } from 'langium/node'

const plugin = oocPlugin()
const RESOLVED_RUNTIME = '\u0000' + OOC_RUNTIME_VIRTUAL_ID

/** 与插件同一路径解析单个 .ooc（langium 同步 fromString）。 */
function parseFrom(code: string) {
  const services = createObjectOrientedCServices(NodeFileSystem)
  return services.shared.workspace.LangiumDocumentFactory.fromString(
    code,
    URI.file('C:/demo/x.ooc'),
  ).parseResult.value as any
}

/** vite 的插件 hook 类型是 ObjectHook（函数或 {handler,...}），这里统一取可调用形态。 */
function hookOf<T extends (...args: any[]) => any>(h: any): T {
  return (typeof h === 'function' ? h : h.handler) as T
}

const transform = hookOf(plugin.transform)!

const withImports = `
math = #import './math.ooc';
helper = #import './helper.ts';
base = #import '@base/loop';
{ add(a, b) { a + b }, use(x) { helper scale x } }
`

test('.ooc transform：import 编译成真 ES import，产物是纯 JS（无 TS 类型语法）', async () => {
  const id = path.resolve('C:/demo/app.ooc')
  const result: any = await transform(withImports, id)
  const code = result.code as string
  if (!/import _m0 from '.\/math.ooc'/.test(code)) {
    throw new Error(`相对 .ooc import 应编译为真 ES import，实际:\n${code}`)
  }
  if (!/import _m1 from '.\/helper.ts'/.test(code)) {
    throw new Error(`相对 .ts import 应原样进模块图，实际:\n${code}`)
  }
  if (!/import _m2 from '.*\.ooc_modules\/base\/loop\.ooc'/.test(code)) {
    throw new Error(`@pkg import 应解析到 .ooc_modules/<pkg>/ 下（@ 前缀去掉），实际:\n${code}`)
  }
  if (!/let math = await _m0\(globals\)/.test(code)) {
    throw new Error(`#import 绑定应 await 依赖模块 run(globals)，实际:\n${code}`)
  }
  if (/export type /m.test(code) || /: number|: string|: boolean/.test(code)) {
    throw new Error(`产物应无 TS 类型语法（应为 JS）：\n${code}`)
  }
  if (!/from 'virtual:ooc-runtime'/.test(code)) {
    throw new Error(`runtime 应走虚拟模块：\n${code}`)
  }
})

test('.ooc transform：#type 提升到模块顶层（modelToTs 层验证，JS 产物无类型别名）', async () => {
  const src = `
Circle #type { kind(): 'circle', radius: number };
{ area(r) { (r radius) * (r radius) * 3.14 } }
`
  const result: any = await transform(src, path.resolve('C:/demo/shape.ooc'))
  const code = result.code as string
  if (/export type /.test(code)) {
    throw new Error(`JS 产物不应含类型别名（transpileModule 会剥掉）：\n${code}`)
  }
  const tsCode = modelToTs(parseFrom(src), { runtimeImport: 'virtual:ooc-runtime', deps: [] })
  const typeAt = tsCode.indexOf('export type Circle')
  const markerAt = tsCode.indexOf('// ---- 编译产物 ----')
  if (typeAt < 0 || markerAt < 0 || typeAt > markerAt) {
    throw new Error(`#type 应提升到 run 之前（模块顶层 export type），实际:\n${tsCode}`)
  }
})

test('虚拟 runtime 模块：resolveId 归一化、load 返回去掉类型的 JS', async () => {
  const resolved: any = hookOf(plugin.resolveId)(OOC_RUNTIME_VIRTUAL_ID)
  if (resolved !== RESOLVED_RUNTIME) {
    throw new Error(`resolveId 应返回 ${RESOLVED_RUNTIME}，实际 ${resolved}`)
  }
  const loaded: any = hookOf(plugin.load)(RESOLVED_RUNTIME)
  const js = loaded.code as string
  if (!/export function __send\(/.test(js)) {
    throw new Error(`runtime 应含 __send 导出，实际:\n${js}`)
  }
  if (/Record<string|: any/.test(js)) {
    throw new Error(`runtime 虚拟模块应为纯 JS（无类型注解），实际:\n${js}`)
  }
})

test('非 .ooc 文件不打扰：transform/load 返回 undefined', async () => {
  if ((await transform('const x: number = 1', path.resolve('C:/demo/a.ts'))) !== undefined) {
    throw new Error('.ts 文件不应被本插件 transform')
  }
  if (hookOf(plugin.load)('/abs/path/a.ts') !== undefined) {
    throw new Error('非虚拟 id 不应被 load')
  }
})