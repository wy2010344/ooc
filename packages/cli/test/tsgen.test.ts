// tsgen 端到端测试：.ooc → 编译成纯 ES .ts 产物（Node ≥23.6 原生类型剥离直接 import）→
// 运行断言（语义与解释器一致）。覆盖：guard 分支循环、宿主依赖按 import 导入、跨模块 import、
// 命名导入。（类型形态与命名空间类型见 tsgen-types.test.ts；同层重复声明由 language 校验拦截）
import { test } from 'node:test'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { pathToFileURL } from 'node:url'
import { compileAction } from 'object-oriented-c-cli'
import { CAN_RUN, compileSource, loadRuntime } from './tsgen-helpers.js'

// 精简 loop fixture：guard 分支（递归 $ + nil 兜底）+ repeat（JS 字符串生态 forEach）
const LOOP_SRC = `
loop = {
    $(fn) {
        #guard fn $;
        this $ fn
        #else;
        nil
    },
    repeat(n, fn) {
        (('x' repeat n) split '') forEach [v, i => fn $ i];
        nil
    }
};
loop
`

test('guard 分支循环：$ 至少一次并按真值递归，repeat 恰好 n 次', async (t) => {
  const { ts: tsPath, dir } = await compileSource('loop', LOOP_SRC)
  if (!CAN_RUN) return t.skip('Node <23 无原生类型剥离')

  const mod = await import(pathToFileURL(tsPath).href)
  const loop = mod.default
  const rt = await loadRuntime(dir)

  let count = 0
  rt.__send(loop, '$', [() => ++count < 3])
  if (count !== 3) throw new Error(`$ 循环应跑 3 次，实际 ${count}`)

  let sum = 0
  rt.__send(loop, 'repeat', [4, (i: number) => { sum += i }])
  if (sum !== 6) throw new Error(`repeat 4 次应累加 0..3=6，实际 ${sum}`)
})

test('$ 直接调用编译为统一的 `$` 消息', async (t) => {
  const { ts: tsPath } = await compileSource('dollar', `
inc = [x => x + 1];
obj = { $(x) => x * 3 };
inc $ (obj $ 4)
`)
  const code = await fs.readFile(tsPath, 'utf-8')
  if (!/__send\(inc, "\$"/.test(code)) throw new Error('$ 应编译成 `$` 消息')
  if (!CAN_RUN) return t.skip('Node <23 无原生类型剥离')
  const mod = await import(pathToFileURL(tsPath).href)
  if (mod.default !== 13) throw new Error(`$ 求值应为 13，实际 ${mod.default}`)
})

test('$ 中缀带多实参编译为同一条 `$` 消息', async (t) => {
  const { ts: tsPath } = await compileSource('dollarargs', `
add = { $(a, b) => a + b };
obj = { get { add } };
obj get $ 20 22
`)
  const code = await fs.readFile(tsPath, 'utf-8')
  if (!/"\$",\s*\[20, 22\]/.test(code)) {
    throw new Error(`$ 中缀应编译成带 [20, 22] 的 \`$\` 消息，实际:\n${code}`)
  }
  if (!CAN_RUN) return t.skip('Node <23 无原生类型剥离')
  const mod = await import(pathToFileURL(tsPath).href)
  if (mod.default !== 42) throw new Error(`$ 中缀求值应为 42，实际 ${mod.default}`)
})

test('#guard 前的语句先执行：赋值进作用域后 guard 链才能引用', async (t) => {  const { ts: tsPath, dir } = await compileSource('guardpre', `
obj = {
    fun(a) {
        t = a * 2;
        #guard t > 10;
        t + 1
        #else;
        t
    },
    pair {
        r1 = this fun 3;
        r2 = this fun 8;
        Array of r1 r2
    }
};
obj
`)
  if (!CAN_RUN) return t.skip('Node <23 无原生类型剥离')
  const mod = await import(pathToFileURL(tsPath).href)
  const rt = await loadRuntime(dir)
  const pair = rt.__send(mod.default, 'pair', [])
  if (JSON.stringify(pair) !== JSON.stringify([6, 17])) {
    throw new Error(`guard 前赋值应对分支可见，期望 [6,17]，实际 ${JSON.stringify(pair)}`)
  }
})

test('lambda 的 #guard / #else 分支可编译并执行', async (t) => {
  const { ts: tsPath } = await compileSource('lambdaguard', `
f = [x =>
    #guard x > 0;
    x
    #else;
    0 - x
];
Array of (f $ 5) (f $ (0 - 3))
`)
  if (!CAN_RUN) return t.skip('Node <23 无原生类型剥离')
  const mod = await import(pathToFileURL(tsPath).href)
  if (JSON.stringify(mod.default) !== JSON.stringify([5, 3])) {
    throw new Error(`lambda guard 求值应为 [5,3]，实际 ${JSON.stringify(mod.default)}`)
  }
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
loop $ [n set ((n get) + 1); (n get) < 5];
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

test('bind 惰性 + 多语句块：编译成 thunk，运行时只算一次', async (t) => {
  const { dir } = await compileSource('bindblock', `
tally = 5;
obj = { v = @{ n = tally + 1; n }, w = @{ m = tally; m * 2 } };
{ get { (obj v) + (obj v) + (obj w) } }
`)
  if (!CAN_RUN) return t.skip('Node <23 无原生类型剥离')
  const mod = await import(pathToFileURL(path.join(dir, 'bindblock.ts')).href)
  const rt = await loadRuntime(dir)
  const value = rt.__send(mod.default, 'get', [])
  // v 惰性只算一次（tally+1=6），w 用外层 tally *2=10；合计 6 + 6 + 10
  if (value !== 22) throw new Error(`bind 惰性块应为 22，实际 ${value}`)
  const code = await fs.readFile(path.join(dir, 'bindblock.ts'), 'utf8')
  if (!/get "v"\(\)/.test(code) || !/__ooc\$d0/.test(code) || /__createObject\(/.test(code)) {
    throw new Error(`bind 应生成带闭包缓存的对象字面量 getter，且无 __createObject，实际:\n${code}`)
  }
})

test('命名导入：跨模块绑定顶层声明的值', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ooc-tsgen-'))
  await fs.writeFile(
    path.join(dir, 'lib.ooc'),
    `Point #type { x: number };
make = { p { { x = 42 } } };
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
Point #type { x: number };
scale = 2;
factory = { make { { x = 1 } } };
factory
`)
  const code = await fs.readFile(path.join(dir, 'shape.ts'), 'utf8')
  for (const expect of [
    'export type Point =',
    'export const scale = 2;',
    'export const factory =',
    'export default factory;',
    'Object.freeze({',
    'Object.freeze({ "x": 1 })',
  ]) {
    if (!code.includes(expect)) throw new Error(`产物应含 ${expect}，实际:\n${code}`)
  }
  if (/__createObject/.test(code)) {
    throw new Error(`对象构造不应再走 __createObject，实际:\n${code}`)
  }
  // 不再有 run()/bag/内联运行时那套模板
  if (/export const __oocNamed|export async function run\(|OOC_NUM_DEF/.test(code)) {
    throw new Error(`产物不应再有自包含模板，实际:\n${code}`)
  }
})
