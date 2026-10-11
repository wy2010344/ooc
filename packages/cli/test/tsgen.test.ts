// tsgen 端到端测试：.ooc → 编译成纯 ES .ts 产物（Node ≥23.6 原生类型剥离直接 import）→
// 运行断言（语义与解释器一致）。覆盖：guard 重载循环、宿主依赖按 import 导入、跨模块 import、
// 顶层重复绑定、命名导入、同名 .d.ts。
import { test } from 'node:test'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { pathToFileURL } from 'node:url'
import { compileAction } from 'object-oriented-c-cli'

const CAN_RUN = Number(process.versions.node.split('.')[0]) >= 23

/** 把 .ooc 源编译到临时目录，返回入口产物路径 */
async function compileSource(name: string, source: string): Promise<{ ts: string; dir: string }> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ooc-tsgen-'))
  const srcPath = path.join(dir, `${name}.ooc`)
  await fs.writeFile(srcPath, source, 'utf-8')
  await compileAction(srcPath, { destination: dir })
  return { ts: path.join(dir, `${name}.ts`), dir }
}

/** 共享 runtime：产物从它 import __send/__createObject */
async function loadRuntime(dir: string): Promise<any> {
  return import(pathToFileURL(path.join(dir, '_ooc_runtime.ts')).href)
}

// 精简 loop fixture：guard 重载（递归 apply + nil 兜底）+ repeat（JS 字符串生态 forEach）
const LOOP_SRC = `
loop = {
    apply(fn) {
        #guard fn apply;
        this apply fn
        #else;
        nil
    },
    repeat(n, fn) {
        (('x' repeat n) split '') forEach [v, i => fn apply i];
        nil
    }
};
loop
`

test('guard 分支循环：apply 至少一次并按真值递归，repeat 恰好 n 次', async (t) => {
  const { ts: tsPath, dir } = await compileSource('loop', LOOP_SRC)
  if (!CAN_RUN) return t.skip('Node <23 无原生类型剥离')

  const mod = await import(pathToFileURL(tsPath).href)
  const loop = mod.default
  const rt = await loadRuntime(dir)

  let count = 0
  rt.__send(loop, 'apply', [() => ++count < 3])
  if (count !== 3) throw new Error(`apply 循环应跑 3 次，实际 ${count}`)

  let sum = 0
  rt.__send(loop, 'repeat', [4, (i: number) => { sum += i }])
  if (sum !== 6) throw new Error(`repeat 4 次应累加 0..3=6，实际 ${sum}`)
})

test('跨模块 import + 宿主模块 import：storage ref 与 loop 组合', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ooc-tsgen-'))
  await fs.writeFile(path.join(dir, 'loop.ooc'), LOOP_SRC, 'utf-8')
  // 宿主依赖就是普通 TS 模块，按名字 import（不再有 globals 注入）
  await fs.writeFile(
    path.join(dir, 'host.ts'),
    `export default {
  storage: {
    ref(v: number) {
      let _v = v
      return { get: () => _v, set: (x: number) => { _v = x } }
    },
  },
}
`,
    'utf-8',
  )
  await fs.writeFile(
    path.join(dir, 'demo.ooc'),
    `loop = #import './loop';
host = #import './host.ts';
n = (host storage) ref 0;
loop apply [n set ((n get) + 1); (n get) < 5];
{ iterations = (n get) }
`,
    'utf-8',
  )
  await compileAction(path.join(dir, 'demo.ooc'), { destination: dir })
  if (!CAN_RUN) return t.skip('Node <23 无原生类型剥离')

  const mod = await import(pathToFileURL(path.join(dir, 'demo.ts')).href)
  const rt = await loadRuntime(dir)
  const value = rt.__send(mod.default, 'iterations', [])
  if (value !== 5) throw new Error(`iterations 应为 5，实际 ${value}`)
})

test('宿主依赖是普通 import：产物没有 __globals/__globalsOf，也没有 _ooc_globals.ts', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ooc-tsgen-'))
  await fs.writeFile(
    path.join(dir, 'host.ts'),
    `export const storage = { ref: (v: unknown) => ({ value: v }) }\n`,
    'utf-8',
  )
  await fs.writeFile(
    path.join(dir, 'uses-host.ooc'),
    `#import { storage } './host.ts';
n = storage ref 0;
{ ok = (n value) }
`,
    'utf-8',
  )
  await compileAction(path.join(dir, 'uses-host.ooc'), { destination: dir })
  const code = await fs.readFile(path.join(dir, 'uses-host.ts'), 'utf8')
  if (!/import \{ storage \} from '\.\/host\.ts'/.test(code)) {
    throw new Error(`宿主依赖应编译成普通 ES import，实际:\n${code}`)
  }
  if (/__globals|__globalsOf|_ooc_globals/.test(code)) {
    throw new Error(`产物不应再有任何 globals 注入痕迹，实际:\n${code}`)
  }
  // 产物目录里也不该再有 _ooc_globals.ts
  const outs = await fs.readdir(dir)
  if (outs.includes('_ooc_globals.ts')) {
    throw new Error(`不应再生成 _ooc_globals.ts，实际产物 ${outs.join(', ')}`)
  }
})

test('顶层重复绑定编译为重赋，不产生重复 let', async () => {
  const { dir } = await compileSource('rebind', `
calc = 1;
calc = 2;
{ done = calc }
`)
  const code = await fs.readFile(path.join(dir, 'rebind.ts'), 'utf8')
  const lets = code.match(/let calc = /g) ?? []
  if (lets.length !== 1) throw new Error(`let calc 应只声明 1 次，实际 ${lets.length}`)
  if (!/[^=]calc = 2;/.test(code)) throw new Error('第二次绑定应生成重赋 calc = 2')
})

test('命名导入：跨模块绑定顶层声明的值', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ooc-tsgen-'))
  await fs.writeFile(
    path.join(dir, 'lib.ooc'),
    `Point #type { x(): number };
make = { p() { { x() { 42 } } } };
make
`,
    'utf-8',
  )
  await fs.writeFile(
    path.join(dir, 'use.ooc'),
    `#import { make } 'lib';
m = make p;
m x
`,
    'utf-8',
  )
  await compileAction(path.join(dir, 'use.ooc'), { destination: dir })
  if (!CAN_RUN) return t.skip('Node <23 无原生类型剥离')

  const mod = await import(pathToFileURL(path.join(dir, 'use.ts')).href)
  if (mod.default !== 42) throw new Error(`命名导入取值应为 42，实际 ${mod.default}`)
})

test('纯 ES 产物形态：顶层声明 export、默认导出 = 最后一条表达式、运行时外部导入', async () => {
  const { dir } = await compileSource('shape', `
Point #type { x(): number };
scale = 2;
factory = { make() { { x() { 1 } } } };
factory
`)
  const code = await fs.readFile(path.join(dir, 'shape.ts'), 'utf8')
  for (const expect of [
    'export type Point =',
    'export const scale = 2;',
    'export const factory =',
    'export default factory;',
    "import { __createObject } from './_ooc_runtime.ts';",
  ]) {
    if (!code.includes(expect)) throw new Error(`产物应含 ${expect}，实际:\n${code}`)
  }
  // 不再有 run()/bag/内联运行时那套模板
  if (/export const __oocNamed|export async function run\(|OOC_NUM_DEF/.test(code)) {
    throw new Error(`产物不应再有自包含模板，实际:\n${code}`)
  }
})

test('同名 .d.ts：TS 侧 import 编译产物拿到真实类型（含泛型 typedef）', async () => {
  const { dir } = await compileSource('typed', `
Point #type { x(): number, y(): number };
Box #type <T> { value(): T };
origin = { x() { 0 }, y() { 0 } };
scale = 2;
origin
`)
  const dts = await fs.readFile(path.join(dir, 'typed.d.ts'), 'utf8')
  // typedef 原样声明（含泛型）
  if (!/export type Point = \{\s*x\(\): number;\s*y\(\): number\s*\}/.test(dts)) {
    throw new Error(`d.ts 应含 Point 形状，实际:\n${dts}`)
  }
  if (!/export type Box<T> = \{\s*value\(\): T\s*\}/.test(dts)) {
    throw new Error(`d.ts 应含泛型 Box<T>，实际:\n${dts}`)
  }
  // 顶层值：字面量放宽成基础类型，方法签名里保持精确
  if (!/export declare const scale: number;/.test(dts)) {
    throw new Error(`顶层字面量应放宽为 number，实际:\n${dts}`)
  }
  if (!/export declare const origin: \{ x\(\): 0; y\(\): 0 \};/.test(dts)) {
    throw new Error(`对象形状应从方法签名推断，实际:\n${dts}`)
  }
  if (!/export default \{ x\(\): 0; y\(\): 0 \};/.test(dts)) {
    throw new Error(`默认导出应有类型，实际:\n${dts}`)
  }
})
