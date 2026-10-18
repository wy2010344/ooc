// tsgen 端到端测试：.ooc → 编译成纯 ES .ts 产物（Node ≥23.6 原生类型剥离直接 import）→
// 运行断言（语义与解释器一致）。覆盖：guard 分支循环、宿主依赖按 import 导入、跨模块 import、
// 顶层重复绑定、命名导入。（类型形态与命名空间类型见 tsgen-types.test.ts）
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

/** 共享 runtime：产物从它 import __send/__createObject/__spread */
async function loadRuntime(dir: string): Promise<any> {
  return import(pathToFileURL(path.join(dir, '_ooc_runtime.ts')).href)
}

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
  rt.__send(loop, 'apply', [() => ++count < 3])
  if (count !== 3) throw new Error(`$ 循环应跑 3 次，实际 ${count}`)

  let sum = 0
  rt.__send(loop, 'repeat', [4, (i: number) => { sum += i }])
  if (sum !== 6) throw new Error(`repeat 4 次应累加 0..3=6，实际 ${sum}`)
})

test('$ 直接调用编译为统一消息（宿主成员名 apply）', async (t) => {
  const { ts: tsPath } = await compileSource('dollar', `
inc = [x => x + 1];
obj = { $(x) => x * 3 };
inc $ (obj $ 4)
`)
  const code = await fs.readFile(tsPath, 'utf-8')
  if (!/__send\(inc, "apply"/.test(code)) throw new Error('$ 应编译成统一 apply 消息')
  if (!CAN_RUN) return t.skip('Node <23 无原生类型剥离')
  const mod = await import(pathToFileURL(tsPath).href)
  if (mod.default !== 13) throw new Error(`$ 求值应为 13，实际 ${mod.default}`)
})

test('$ 中缀带多实参编译为统一 apply 消息', async (t) => {
  const { ts: tsPath } = await compileSource('dollarargs', `
add = { $(a, b) => a + b };
obj = { get { add } };
obj get $ 20 22
`)
  const code = await fs.readFile(tsPath, 'utf-8')
  if (!/"apply",\s*\[20, 22\]/.test(code)) {
    throw new Error(`$ 中缀应编译成带 [20, 22] 的 apply 消息，实际:\n${code}`)
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
  if (!/type: 'bind'/.test(code) || !/fn: function/.test(code)) {
    throw new Error(`bind 应编译成 fn thunk，实际:\n${code}`)
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
    "import { __createObject } from './_ooc_runtime.ts';",
  ]) {
    if (!code.includes(expect)) throw new Error(`产物应含 ${expect}，实际:\n${code}`)
  }
  // 不再有 run()/bag/内联运行时那套模板
  if (/export const __oocNamed|export async function run\(|OOC_NUM_DEF/.test(code)) {
    throw new Error(`产物不应再有自包含模板，实际:\n${code}`)
  }
})

test('消息实参 ...array 展开：编译成 __spread，运行语义与解释器一致', async (t) => {
  const { ts: tsPath, dir } = await compileSource('spread', `
obj = { $(...xs) { xs } };
arr = Array of 1 2 3;
{ collect = (obj $ ...arr), mixed = (obj $ 0 ...arr 9) }
`)
  const code = await fs.readFile(tsPath, 'utf8')
  if (!/__spread\(/.test(code)) {
    throw new Error(`展开参数应编译成 __spread，实际:\n${code}`)
  }
  if (!/import \{ __send, __createObject, __spread \} from '\.\/_ooc_runtime\.ts';/.test(code)) {
    throw new Error(`应 import __spread，实际:\n${code}`)
  }
  if (!CAN_RUN) return t.skip('Node <23 无原生类型剥离')
  const mod = await import(pathToFileURL(tsPath).href)
  const rt = await loadRuntime(dir)
  const collect = rt.__send(mod.default, 'collect', [])
  if (JSON.stringify(collect) !== JSON.stringify([1, 2, 3])) {
    throw new Error(`...arr 应展开为 [1,2,3]，实际 ${JSON.stringify(collect)}`)
  }
  const mixed = rt.__send(mod.default, 'mixed', [])
  if (JSON.stringify(mixed) !== JSON.stringify([0, 1, 2, 3, 9])) {
    throw new Error(`混用应展开为 [0,1,2,3,9]，实际 ${JSON.stringify(mixed)}`)
  }
})

test('lambda 保留：成员返回 lambda 本体，读取不二次 $', async (t) => {
  const { ts: tsPath, dir } = await compileSource('lam', `
obj = { handler => [x => x + 1], inc = [x => x + 2] };
obj
`)
  if (!CAN_RUN) return t.skip('Node <23 无原生类型剥离')
  const mod = await import(pathToFileURL(tsPath).href)
  const rt = await loadRuntime(dir)
  // __send 读属性成员：拿到 lambda 本体而非执行结果
  const h = rt.__send(mod.default, 'handler', [])
  if (typeof h !== 'function') throw new Error('handler 应为 lambda 函数本体')
  if (h(41) !== 42) throw new Error('lambda 直调应得 42')
  // bind 形同理
  const inc = rt.__send(mod.default, 'inc', [])
  if (typeof inc !== 'function') throw new Error('inc 应为 lambda 函数本体')
  if (rt.__send(inc, 'apply', [41]) !== 43) throw new Error('$ 显式调用应得 43')
  // JS 直读：bind 成员（getter）是 lambda 本体；零参 call 成员是方法本体（调用才执行）
  if (typeof mod.default.inc !== 'function') throw new Error('JS 直读 inc 应为 lambda 本体')
  if (mod.default.inc(41) !== 43) throw new Error('JS 直调 inc lambda 应得 43')
  const viaMethod = mod.default.handler()
  if (typeof viaMethod !== 'function') throw new Error('handler 调用应返回 lambda 本体')
  if (viaMethod(1) !== 2) throw new Error('返回的 lambda 直调应得 2')
})

test('转发属性 <=：编译成 __mutable 转发器，消息原样转发给委托 $', async (t) => {
  const { ts: tsPath, dir } = await compileSource('fwd', `
delegate = { $(a, b) => a + b };
obj = { count <= delegate };
obj
`)
  if (!CAN_RUN) return t.skip('Node <23 无原生类型剥离')
  const mod = await import(pathToFileURL(tsPath).href)
  const rt = await loadRuntime(dir)
  // count 是转发属性：发消息 -> 委托对象 $(3, 4) = 7
  if (rt.__send(mod.default, 'count', [3, 4]) !== 7) {
    throw new Error('<= 应把消息转发给委托对象的 $')
  }
  if (rt.__send(mod.default, 'count', [5, 6]) !== 11) {
    throw new Error('<= 委托对象惰性求值一次后持续可用')
  }
})

test('模版字符串：编译成 [文本/洞].join("")，运行语义与解释器一致', async (t) => {
  const { ts: tsPath, dir } = await compileSource('tpl', `
obj = { greeting(name) { 'hello \${name}! n=\${1 + 2}' } };
{ msg = (obj greeting 'world') }
`)
  const code = await fs.readFile(tsPath, 'utf8')
  if (!/\]\.join\(''\)/.test(code)) {
    throw new Error(`模版字符串应编译成 join('')，实际:\n${code}`)
  }
  if (!CAN_RUN) return t.skip('Node <23 无原生类型剥离')
  const mod = await import(pathToFileURL(tsPath).href)
  const rt = await loadRuntime(dir)
  const msg = rt.__send(mod.default, 'msg', [])
  if (msg !== 'hello world! n=3') {
    throw new Error(`模版结果应为 'hello world! n=3'，实际 ${msg}`)
  }
})
