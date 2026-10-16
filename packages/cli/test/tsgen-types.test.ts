// tsgen 类型形态测试：typedef 产物形态（属性形态、无旁挂 .d.ts）+ 命名空间类型
// `ns#Name` 进产物（值侧默认导入、类型位补 `ns$ns` 命名空间导入）。
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

test('.ts 产物含 typedef（属性形态），不再写同名 .d.ts', async () => {
  const { ts: tsPath, dir } = await compileSource('typed', `
Point #type { x: number, y: number };
Box #type <T> { value: T };
origin = { x = 0, y = 0 };
scale = 2;
origin
`)
  const code = await fs.readFile(tsPath, 'utf8')
  // typedef 在 .ts 产物里（属性形态：零参成员 = 判别字段）
  if (!/export type Point = \{\s*x: number;\s*y: number\s*\};/.test(code)) {
    throw new Error(`.ts 应含 Point 形状，实际:\n${code}`)
  }
  if (!/export type Box<T> = \{\s*value: T\s*\};/.test(code)) {
    throw new Error(`.ts 应含泛型 Box<T>，实际:\n${code}`)
  }
  // 不再旁挂 .d.ts（TS 解析同名 .ts 优先，.d.ts 是死文件）
  let hasDts = true
  try {
    await fs.readFile(path.join(dir, 'typed.d.ts'), 'utf8')
  } catch {
    hasDts = false
  }
  if (hasDts) {
    throw new Error('不应再生成同名 .d.ts')
  }
})

test('命名空间类型 math#Circle：值走默认导入，类型位补 ns$ns 命名空间导入', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ooc-tsgen-'))
  await fs.writeFile(
    path.join(dir, 'math.ooc'),
    `Circle #type { x: number, y: number };
origin = { x = 0, y = 0 };
origin
`,
    'utf-8',
  )
  await fs.writeFile(
    path.join(dir, 'use.ooc'),
    `math = #import './math';
p: math#Circle = math;
{ px = p x }
`,
    'utf-8',
  )
  await compileAction(path.join(dir, 'use.ooc'), { destination: dir })
  const code = await fs.readFile(path.join(dir, 'use.ts'), 'utf8')

  if (!/import math from '\.\/math(\.ts)?';/.test(code)) {
    throw new Error(`值侧应是默认导入，实际:\n${code}`)
  }
  if (!/import \* as math\$ns from '\.\/math(\.ts)?';/.test(code)) {
    throw new Error(`类型位应补发 math$ns 命名空间导入，实际:\n${code}`)
  }
  if (!/p: math\$ns\.Circle = /.test(code)) {
    throw new Error(`math#Circle 应编译成 math$ns.Circle，实际:\n${code}`)
  }
  if (/: Circle = /.test(code)) {
    throw new Error(`不应出现无命名空间的裸 Circle 类型引用，实际:\n${code}`)
  }

  if (!CAN_RUN) return t.skip('Node <23 无原生类型剥离')
  const mod = await import(pathToFileURL(path.join(dir, 'use.ts')).href)
  if (mod.default.px !== 0) {
    throw new Error(`ns 类型标注擦除后运行值应为 0，实际 ${mod.default.px}`)
  }
})
