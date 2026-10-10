// vite-plugin-ooc 单元测试：直接调用插件 hook（不启动 vite，保证 Termux 可用）。
// 覆盖：.ooc 归一化为虚拟 id 并从磁盘 load 出纯 JS、#import 相对/包/.ts 编译成真 ES import、
// 虚拟 runtime 模块。dev 与 build 共用 resolveId+load 同一路径，测试即覆盖 dev。
import { test } from 'node:test'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { oocPlugin, OOC_RUNTIME_VIRTUAL_ID } from 'vite-plugin-ooc'
import { modelToTs, OOC_RUNTIME_MODULE } from 'object-oriented-c-cli'
import { ObjectValue, createObjectOrientedCServices } from 'object-oriented-c-language'
import { URI } from 'langium'
import { NodeFileSystem } from 'langium/node'
import * as ts from 'typescript'

const plugin = oocPlugin()
const RESOLVED_RUNTIME = '\u0000' + OOC_RUNTIME_VIRTUAL_ID

/** vite 的插件 hook 类型是 ObjectHook（函数或 {handler,...}），这里统一取可调用形态。 */
function hookOf<T extends (...args: any[]) => any>(h: any): T {
  return (typeof h === 'function' ? h : h.handler) as T
}

const resolveId = hookOf(plugin.resolveId)!
const load = hookOf(plugin.load)!
const ctx = {} as any

/** 与插件同一路径解析单个 .ooc（langium 同步 fromString）。 */
function parseFrom(code: string, uri = 'C:/demo/x.ooc') {
  const services = createObjectOrientedCServices(NodeFileSystem)
  return services.shared.workspace.LangiumDocumentFactory.fromString(
    code,
    URI.file(uri),
  ).parseResult.value as any
}

// 临时目录：app.ooc 导入同目录 math.ooc 与 helper.ts，模拟真项目文件结构
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ooc-plugin-'))
const appPath = path.join(dir, 'ooc', 'app.ooc')
const mathPath = path.join(dir, 'ooc', 'math.ooc')
const helperPath = path.join(dir, 'ooc', 'helper.ts')
fs.mkdirSync(path.dirname(appPath), { recursive: true })
fs.writeFileSync(
  appPath,
  `math = #import './math.ooc';
helper = #import './helper.ts';
{ add(a, b) { a + b }, use(x) { helper scale x } }
`,
)
fs.writeFileSync(mathPath, `{ double(x) { x * 2 } }`)
fs.writeFileSync(helperPath, `export default 10`)
test.after(() => fs.rmSync(dir, { recursive: true, force: true }))

test('.ooc resolveId：相对引用归一化为真实绝对路径 id，dev/build 共用同一路径', () => {
  const fromMain = path.join(dir, 'main.ts')
  const id1 = resolveId.call(ctx, './ooc/app.ooc', fromMain)
  if (id1 !== path.normalize(appPath)) {
    throw new Error(`期望 ${appPath}，实际 ${id1}`)
  }
  // 编译产物里互相 import（importer 是绝对路径）也能继续解析
  const id2 = resolveId.call(ctx, './math.ooc', path.normalize(appPath))
  if (id2 !== path.normalize(mathPath)) {
    throw new Error(`子模块相对解析出错：${id2}`)
  }
  // dev 浏览器 URL 形态（/src/ooc/app.ooc，Windows 上不带盘符）应落到 root 下
  const config = { root: dir }
  hookOf(plugin.configResolved)!(config as any)
  const id3 = resolveId.call(ctx, '/src/ooc/app.ooc')
  if (id3 !== path.normalize(path.join(dir, 'src', 'ooc', 'app.ooc'))) {
    throw new Error(`dev URL 解析出错：${id3}`)
  }
  if (resolveId.call(ctx, OOC_RUNTIME_VIRTUAL_ID) !== RESOLVED_RUNTIME) {
    throw new Error('runtime 虚拟 id 归一化失败')
  }
  // .ts 不接管，交给 vite 原生解析
  if (resolveId.call(ctx, './helper.ts', path.normalize(appPath)) !== undefined) {
    throw new Error('.ts 不应被本插件接管')
  }
})

test('.ooc load：读磁盘 transform 成纯 JS，import 编译成真 ES import', async () => {
  const result: any = load.call(ctx, path.normalize(appPath))
  const code = result.code as string
  if (!/import math from '.\/math.ooc'/.test(code)) {
    throw new Error(`默认导入应编译成 ES default import，实际:\n${code}`)
  }
  if (!/import helper from '.\/helper.ts'/.test(code)) {
    throw new Error(`相对 .ts import 应原样进模块图，实际:\n${code}`)
  }
  if (/export default function run|__oocNamed|_m0\(globals\)/.test(code)) {
    throw new Error(`纯 ES 产物不应再有 run/bag 模板，实际:\n${code}`)
  }
  if (/export type /m.test(code) || /: number|: string|: boolean/.test(code)) {
    throw new Error(`产物应无 TS 类型语法（应为 JS）：\n${code}`)
  }
  if (!/from 'virtual:ooc-runtime'/.test(code)) {
    throw new Error(`runtime 应走虚拟模块：\n${code}`)
  }
})

test('.ooc load：命名/类型导入按类型与值分类发射（真 ES named import + import type）', () => {
  const namedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ooc-plugin-named-'))
  test.after(() => fs.rmSync(namedDir, { recursive: true, force: true }))
  fs.writeFileSync(
    path.join(namedDir, 'lib.ooc'),
    `Point #type { x(): number };
scale = 2;
factory = { p() { { x() { 42 } } } };
factory
`,
  )
  const appSrc = `#import { scale, factory, Point } 'lib' { Point as P };
factory p
`
  const namedApp = path.join(namedDir, 'app.ooc')
  fs.writeFileSync(namedApp, appSrc)
  const tsCode = modelToTs(parseFrom(appSrc, namedApp), {
    runtimeImport: 'virtual:ooc-runtime',
    deps: [{ path: 'lib', specifier: './lib.ooc', typeNames: ['Point'] }],
  })
  // 类型（Point / P）走 import type；值（scale/factory）走真 ES named import
  if (!/import type \{ Point, Point as P \} from '\.\/lib\.ooc'/.test(tsCode)) {
    throw new Error(`类型导入应合并成 import type，实际:\n${tsCode}`)
  }
  if (!/import \{ scale, factory \} from '\.\/lib\.ooc'/.test(tsCode)) {
    throw new Error(`命名值导入应合并成 ES named import，实际:\n${tsCode}`)
  }
  if (/__oocNamed|run\(globals/.test(tsCode)) {
    throw new Error(`不应再有 bag/run 模板，实际:\n${tsCode}`)
  }
})

test('.ooc load：宿主依赖就是普通 import（.ts），不再是 globals 注入', () => {
  const hostDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ooc-plugin-host-'))
  test.after(() => fs.rmSync(hostDir, { recursive: true, force: true }))
  const hostTs = path.join(hostDir, 'host.ts')
  fs.writeFileSync(
    hostTs,
    `export const storage = { ref: (v: unknown) => ({ value: v }) }\n`,
  )
  const src = `#import { storage } './host.ts';
counter = storage ref 0;
{ bump() { 1 } }
`
  const hostApp = path.join(hostDir, 'host.ooc')
  fs.writeFileSync(hostApp, src)
  const tsCode = modelToTs(parseFrom(src, hostApp), {
    runtimeImport: 'virtual:ooc-runtime',
    deps: [
      { path: './host.ts', specifier: './host.ts', typeNames: [] },
    ],
  })
  if (!/import \{ storage \} from '\.\/host\.ts'/.test(tsCode)) {
    throw new Error(`宿主依赖应编译成普通 ES import，实际:\n${tsCode}`)
  }
  if (/__globals|__globalsOf|_ooc_globals/.test(tsCode)) {
    throw new Error(`不应再有任何 globals 注入痕迹，实际:\n${tsCode}`)
  }
  if (!/export const counter/.test(tsCode)) {
    throw new Error(`顶层声明应 export const，实际:\n${tsCode}`)
  }
})

test('.ooc load：#type 提升等价 modelToTs 行为（typedef 在 TS 层、JS 产物无类型别名）', () => {
  const src = `
Circle #type { kind(): 'circle', radius: number };
{ area(r) { (r radius) * (r radius) * 3.14 } }
`
  fs.writeFileSync(path.join(dir, 'shape.ooc'), src)
  const result: any = load.call(ctx, path.normalize(path.join(dir, 'shape.ooc')))
  if (/export type /.test(result.code)) {
    throw new Error(`JS 产物不应含类型别名（transpileModule 剥掉）：\n${result.code}`)
  }
  const tsCode = modelToTs(parseFrom(src, path.join(dir, 'shape.ooc')), {
    runtimeImport: 'virtual:ooc-runtime',
    deps: [],
  })
  const typeAt = tsCode.indexOf('export type Circle')
  const markerAt = tsCode.indexOf('// ---- 编译产物 ----')
  if (typeAt < 0 || markerAt < 0 || typeAt > markerAt) {
    throw new Error(`#type 应提升到 run 之前（模块顶层 export type）:\n${tsCode}`)
  }
})

test('虚拟 runtime 模块：resolveId 归一化、load 返回去掉类型的 JS', () => {
  const loaded: any = load.call(ctx, RESOLVED_RUNTIME)
  const js = loaded.code as string
  if (!/export function __send\(/.test(js)) {
    throw new Error(`runtime 应含 __send 导出，实际:\n${js}`)
  }
  if (/Record<string|: any/.test(js)) {
    throw new Error(`runtime 虚拟模块应为纯 JS（无类型注解），实际:\n${js}`)
  }
})

test('非 .ooc/.runtime id 不打扰：resolveId/load 返回 undefined', () => {
  if (resolveId.call(ctx, './x.ts', appPath) !== undefined) {
    throw new Error('.ts 不应被接管')
  }
  if (load.call(ctx, helperPath) !== undefined) {
    throw new Error('.ts 文件不应被本插件 load')
  }
})

test('反射契约：编译产物 __createObject 的对象可被 ObjectValue.metaOf 读取（call=事件、bind=常量）', async () => {
  // 把共享 runtime 模板转成 JS（同 vite-plugin 的做法），run 一次 __createObject
  const js = ts
    .transpileModule(OOC_RUNTIME_MODULE, {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    })
    .outputText
  const mod: any = await import(
    'data:text/javascript;base64,' + Buffer.from(js).toString('base64')
  )
  const obj = mod.__createObject([
    { type: 'call', name: 'onClick', fn: (e: any) => e + 1, arity: 1, rest: false },
    { type: 'bind', name: 'className', value: 'btn' },
  ])
  const meta = ObjectValue.metaOf(obj)
  if (!meta || Object.prototype.toString.call(meta) !== '[object Map]') {
    throw new Error(`编译产物对象应携带可读元信息，实际 ${meta}`)
  }
  const onClick = meta.get('onClick')?.[0]
  const className = meta.get('className')?.[0]
  if (onClick?.type !== 'call') throw new Error('onClick 应反射为 call（事件回调）')
  if (className?.type !== 'bind') throw new Error('className 应反射为 bind（常量）')
  // 空对象也识别为 OOC 定义值（{} 有元信息）
  if (!ObjectValue.metaOf(mod.__createObject([]))) {
    throw new Error('空对象 {} 也应带元信息')
  }
})