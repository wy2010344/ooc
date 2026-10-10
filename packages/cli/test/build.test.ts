// ooc build 端到端测试：多文件项目（相对 import + @pkg 包引用）→ 编译 .ts 树 +
// 共享 _ooc_runtime.ts，Node 原生类型剥离（≥23.6）直接加载产物验证运行语义。
// 覆盖：依赖图遍历、包路径映射、ES import 说明符相对正确、模块间 run(globals) 组合。
import { test } from 'node:test'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { pathToFileURL } from 'node:url'
import { buildProject } from 'object-oriented-c-cli'

/** 组装一个临时 OOC 项目：src/ 源码 + .ooc_modules/base/ 包，返回根目录。 */
async function makeProject(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ooc-build-'))
  await fs.mkdir(path.join(root, 'src'), { recursive: true })
  await fs.mkdir(path.join(root, '.ooc_modules', 'base'), { recursive: true })

  await fs.writeFile(
    path.join(root, 'src', 'math.ooc'),
    `// 数学工具模块（相对 import 的目标）
{ add(a, b) { a + b }, double(x) { x * 2 } }
`,
    'utf-8',
  )

  // base 包：OOC 语言实现的循环（经 @pkg 引用）
  await fs.writeFile(
    path.join(root, '.ooc_modules', 'base', 'loop.ooc'),
    `// base 包循环：guard 重载（递归 apply + nil 兜底）
loop = {
    apply(fn) {
        #guard fn apply;
        this apply fn
    },
    apply(fn) => nil,
    repeat(n, fn) {
        i = 0;
        [ i < n; fn apply i; i = i + 1 ];
        nil
    }
};
loop
`,
    'utf-8',
  )
  await fs.writeFile(
    path.join(root, '.ooc_modules', 'base', 'ooc.json'),
    '{ "name": "base" }',
    'utf-8',
  )

  await fs.writeFile(
    path.join(root, 'src', 'main.ooc'),
    `// 入口：相对 import math + 包 import @base/loop，组合宿主 storage
math = #import './math';
loop = #import '@base/loop';
n = storage ref 0;
loop apply [n set ((n get) + 1); (n get) < 5];
{
    sum = (math add 2 3),
    iterations = (n get),
    double = (math double 4)
}
`,
    'utf-8',
  )
  return root
}

test('ooc build：依赖图（相对+@pkg）编译成 ES 模块树，运行语义与解释器一致', async () => {
  const root = await makeProject()
  const gen = path.join(root, 'generated')
  const result = await buildProject({
    entry: path.join(root, 'src', 'main.ooc'),
    rootDir: root,
    outDir: gen,
  })

  // 产物：入口 + math + 包 loop + 共享 runtime + 共享 globals
  const outs = result.files.map((f) => path.relative(gen, f.out).replace(/\\/g, '/'))
  for (const expected of ['src/main.ts', 'src/math.ts', 'ooc-pkg/base/loop.ts']) {
    if (!outs.includes(expected)) {
      throw new Error(`产物缺失 ${expected}，实际 ${outs.join(', ')}`)
    }
  }
  if (path.basename(result.runtimeOut) !== '_ooc_runtime.ts') {
    throw new Error(`共享运行时文件名应为 _ooc_runtime.ts，实际 ${result.runtimeOut}`)
  }
  if (path.basename(result.globalsOut) !== '_ooc_globals.ts') {
    throw new Error(`共享 globals 文件名应为 _ooc_globals.ts，实际 ${result.globalsOut}`)
  }
  if (path.relative(gen, result.entryOut).replace(/\\/g, '/') !== 'src/main.ts') {
    throw new Error(`入口产物应为 src/main.ts，实际 ${result.entryOut}`)
  }

  // Node ≥23.6 原生类型剥离：直接 import 生成的 .ts 树（纯 ES，import 即执行）
  if (Number(process.versions.node.split('.')[0]) < 23) {
    return
  }
  const rt = await import(pathToFileURL(result.runtimeOut).href)
  // 宿主 globals 走 _ooc_globals.ts：测试项目自带一份并让产物转出去
  const globalsSrc = path.join(root, 'host-globals.ts')
  await fs.writeFile(
    globalsSrc,
    `export default { storage: { ref: (v: number) => { let _v = v; return { get: () => _v, set: (x: number) => { _v = x } } } } }`,
    'utf-8',
  )
  await buildProject({
    entry: path.join(root, 'src', 'main.ooc'),
    rootDir: root,
    outDir: gen,
    globalsModule: globalsSrc,
  })
  const mod = await import(pathToFileURL(result.entryOut).href + '?v=2')
  const value = mod.default

  const sum = rt.__send(value, 'sum', [])
  if (sum !== 5) throw new Error(`math add 2 3 应为 5，实际 ${sum}`)
  const iterations = rt.__send(value, 'iterations', [])
  if (iterations !== 5) throw new Error(`loop 应跑 5 次，实际 ${iterations}`)
  const double = rt.__send(value, 'double', [])
  if (double !== 8) throw new Error(`math double 4 应为 8，实际 ${double}`)
})