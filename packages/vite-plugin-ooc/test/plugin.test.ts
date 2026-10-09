// vite-plugin-ooc 单元测试：直接调用插件 hook（不启动 vite，保证 Termux 可用）。
// 覆盖：.ooc 归一化为虚拟 id 并从磁盘 load 出纯 JS、#import 相对/包/.ts 编译成真 ES import、
// 虚拟 runtime 模块。dev 与 build 共用 resolveId+load 同一路径，测试即覆盖 dev。
import { test } from 'node:test'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { oocPlugin, OOC_RUNTIME_VIRTUAL_ID } from 'vite-plugin-ooc'
import { modelToTs } from 'object-oriented-c-cli'
import { createObjectOrientedCServices } from 'object-oriented-c-language'
import { URI } from 'langium'
import { NodeFileSystem } from 'langium/node'

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
function parseFrom(code: string) {
  const services = createObjectOrientedCServices(NodeFileSystem)
  return services.shared.workspace.LangiumDocumentFactory.fromString(
    code,
    URI.file('C:/demo/x.ooc'),
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
fs.writeFileSync(helperPath, `export default function run(globals: any) { return Promise.resolve(10) }`)
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
  if (!/import _m0 from '.\/math.ooc'/.test(code)) {
    throw new Error(`相对 .ooc import 应编译为真 ES import，实际:\n${code}`)
  }
  if (!/import _m1 from '.\/helper.ts'/.test(code)) {
    throw new Error(`相对 .ts import 应原样进模块图，实际:\n${code}`)
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
  const tsCode = modelToTs(parseFrom(src), { runtimeImport: 'virtual:ooc-runtime', deps: [] })
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