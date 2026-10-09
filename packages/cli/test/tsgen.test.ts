// tsgen 端到端测试：.ooc → 编译 .ts → transpile CJS → 运行断言（语义与解释器一致）。
// 覆盖：guard 重载循环、lambda、宿主 globals 注入、跨模块 import、顶层重复绑定。
import { test } from 'node:test'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { createRequire } from 'node:module'
import * as ts from 'typescript'
import { compileAction } from 'object-oriented-c-cli'

const require_ = createRequire(import.meta.url)

/** 把 .ooc 源编译到临时目录，返回生成的 .ts 路径 */
async function compileSource(name: string, source: string): Promise<{ ts: string; dir: string }> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ooc-tsgen-'))
  const srcPath = path.join(dir, `${name}.ooc`)
  await fs.writeFile(srcPath, source, 'utf-8')
  await compileAction(srcPath, { destination: dir })
  return { ts: path.join(dir, `${name}.ts`), dir }
}

/** TS 产物 → CommonJS 并 require 执行（typescript.transpileModule 纯 JS，Termux 可用） */
function loadModule(tsPath: string): any {
  const src = require_('node:fs').readFileSync(tsPath, 'utf-8')
  const out = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  })
  const cjsPath = tsPath.replace(/\.ts$/, '.cjs')
  require_('node:fs').writeFileSync(cjsPath, out.outputText)
  return require_(cjsPath)
}

// 精简 loop fixture：guard 重载（递归 apply + nil 兜底）+ repeat（JS 字符串生态 forEach）
const LOOP_SRC = `
loop = {
    apply(fn) {
        #guard fn apply;
        this apply fn
    },
    apply(fn) => nil,
    repeat(n, fn) {
        (('x' repeat n) split '') forEach [v, i => fn apply i];
        nil
    }
};
loop
`

test('guard 重载循环：apply 至少一次并按真值递归，repeat 恰好 n 次', async () => {
  const { ts: tsPath } = await compileSource('loop', LOOP_SRC)
  const mod = loadModule(tsPath)
  const loop = await mod.run()

  let count = 0
  const res = loop.apply ? mod.runtime.__send(loop, 'apply', [() => ++count < 3]) : null
  if (count !== 3) throw new Error(`apply 循环应跑 3 次，实际 ${count}`)
  if (res !== null) throw new Error(`apply 假值分支应返回 nil，实际 ${res}`)

  let sum = 0
  mod.runtime.__send(loop, 'repeat', [4, (i: number) => { sum += i }])
  if (sum !== 6) throw new Error(`repeat 4 次应累加 0..3=6，实际 ${sum}`)
})

test('跨模块 import + 宿主 globals：storage ref 与 loop 组合', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ooc-tsgen-'))
  await fs.writeFile(path.join(dir, 'loop.ooc'), LOOP_SRC, 'utf-8')
  const demoSrc = `
loop = #import './loop';
n = storage ref 0;
loop apply [n set ((n get) + 1); (n get) < 5];
{ iterations = (n get) }
`
  await fs.writeFile(path.join(dir, 'demo.ooc'), demoSrc, 'utf-8')
  await compileAction(path.join(dir, 'loop.ooc'), { destination: dir })
  await compileAction(path.join(dir, 'demo.ooc'), { destination: dir })

  const loopMod = loadModule(path.join(dir, 'loop.ts'))
  const demoMod = loadModule(path.join(dir, 'demo.ts'))
  const result = await demoMod.run({ storage: storageHost() }, () => loopMod.run())
  const value = demoMod.runtime.__send(result, 'iterations', [])
  if (value !== 5) throw new Error(`iterations 应为 5，实际 ${value}`)
})

test('宿主 globals 注入：只注入未绑定的外部名，消息名不注入', async () => {
  const src = `
n = storage ref 0;
[ n set ((n get) + 1); (n get) < 5 ];
{ ok = 1 }
`
  const { ts: tsPath } = await compileSource('globalsdemo', src)
  const code = await fs.readFile(tsPath, 'utf-8')
  if (!/const storage = globals\["storage"\]/.test(code)) {
    throw new Error('应注入 storage 宿主 globals')
  }
  // 消息名 set/get 与已绑定名 n 不得被注入
  const injected = [...code.matchAll(/const (\w+) = globals\[/g)].map((m) => m[1])
  for (const name of ['set', 'get', 'n']) {
    if (injected.includes(name)) throw new Error(`消息名/绑定名 ${name} 不应注入 globals`)
  }
})

test('顶层重复绑定编译为重赋，不产生重复 let', async () => {
  const src = `
calc = 1;
calc = 2;
{ done = calc }
`
  const { ts: tsPath } = await compileSource('rebind', src)
  const code = await fs.readFile(tsPath, 'utf-8')
  const lets = code.match(/let calc = /g) ?? []
  if (lets.length !== 1) throw new Error(`let calc 应只声明 1 次，实际 ${lets.length}`)
  if (!/[^=]calc = 2;/.test(code)) throw new Error('第二次绑定应生成重赋 calc = 2')
})

/** 与解释器 storage 桥语义一致：ref 可变单元 */
function storageHost() {
  return {
    ref(v: number) {
      let _v = v
      return {
        get: () => _v,
        set: (x: number) => { _v = x },
      }
    },
  }
}
