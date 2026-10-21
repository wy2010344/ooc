// tsgen 表达式级端到端测试：展开参数、lambda 保留、转发属性、模版字符串、
// 类型断言 #as 与 send 动态消息。运行断言与解释器语义一致。
import { test } from 'node:test'
import * as fs from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { CAN_RUN, compileSource, loadRuntime } from './tsgen-helpers.js'

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
  if (!/import \{ [^}]*__spread[^}]* \} from '\.\/_ooc_runtime\.ts';/.test(code)) {
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
  if (rt.__send(inc, '$', [41]) !== 43) throw new Error('$ 显式调用应得 43')
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
  const code = await fs.readFile(tsPath, 'utf8')
  if (!/Object\.freeze\(\{/.test(code) || !/__mutable\(/.test(code)) {
    throw new Error(`<= 应直接写入冻结字面量并保留 __mutable，实际:\n${code}`)
  }
  if (/__createObject\(/.test(code)) {
    throw new Error(`仅含 <= 的对象不应回退 __createObject，实际:\n${code}`)
  }
  if (!CAN_RUN) return t.skip('Node <23 无原生类型剥离')
  const mod = await import(pathToFileURL(tsPath).href)
  const rt = await loadRuntime(dir)
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

test('类型断言 #as：纯静态擦除，产物无 Promise 包装', async (t) => {
  const { ts: tsPath } = await compileSource('cast', `
n = 33 #as number;
n + 1
`)
  const code = await fs.readFile(tsPath, 'utf8')
  if (/async|Promise/.test(code)) {
    throw new Error(`#as 不应引入异步包装，实际:\n${code}`)
  }
  if (!CAN_RUN) return t.skip('Node <23 无原生类型剥离')
  const mod = await import(pathToFileURL(tsPath).href)
  if (mod.default !== 34) throw new Error(`#as 求值应为 34，实际 ${mod.default}`)
})

test('lambda 的 this 是 lambda 自身（$ 调用 apply(o, args)）', async (t) => {
  const { ts: tsPath, dir } = await compileSource('lam-this', `
f = [x => this];
(f $ 1) == f
`)
  if (!CAN_RUN) return t.skip('Node <23 无原生类型剥离')
  const mod = await import(pathToFileURL(tsPath).href)
  if (mod.default !== true) {
    throw new Error(`lambda 内 this 应等于 lambda 自身，实际 ${String(mod.default)}`)
  }
  const rt = await loadRuntime(dir)
  if (rt.__send(mod.default, '==', [true]) !== true) {
    throw new Error('this 自比较应为 true')
  }
})

test('if / unless / and / or 惰性：未命中的 lambda 不执行', async (t) => {
  const { ts: tsPath } = await compileSource('lazy', `
{ a = (false if [nil nope] [42]), b = (false and [nil nope]),
  c = (true or [nil nope]), d = (true unless [nil nope]),
  e = (false if [nil nope]) }
`)
  if (!CAN_RUN) return t.skip('Node <23 无原生类型剥离')
  const mod = await import(pathToFileURL(tsPath).href)
  if (mod.default.a !== 42) throw new Error(`false if [..] [42] 应为 42，实际 ${mod.default.a}`)
  if (mod.default.b !== false) throw new Error(`false and [..] 应为 false，实际 ${mod.default.b}`)
  if (mod.default.c !== true) throw new Error(`true or [..] 应为 true，实际 ${mod.default.c}`)
  if (mod.default.d !== null) throw new Error(`true unless [..] 应为 null，实际 ${mod.default.d}`)
  if (mod.default.e !== null) throw new Error(`缺省 else 应为 null，实际 ${mod.default.e}`)
})

test('send 动态消息：编译产物运行时支持按名字 + 实参列表分发', async (t) => {
  const { ts: tsPath, dir } = await compileSource('send', `
obj = { k = 42, add(a, b) => a + b };
{ read = (obj send 'k'), call = (obj send 'add' 1 2), list = (obj send 'add' (Array of 1 2)) }
`)
  if (!CAN_RUN) return t.skip('Node <23 无原生类型剥离')
  const mod = await import(pathToFileURL(tsPath).href)
  const rt = await loadRuntime(dir)
  const read = rt.__send(mod.default, 'read', [])
  const call = rt.__send(mod.default, 'call', [])
  const list = rt.__send(mod.default, 'list', [])
  if (read !== 42) throw new Error(`send 读取属性应为 42，实际 ${String(read)}`)
  if (call !== 3) throw new Error(`send 多实参调用应为 3，实际 ${String(call)}`)
  if (list !== 3) throw new Error(`send 数组实参列表应为 3，实际 ${String(list)}`)
})

test('对象快路径：字面量/方法/getter 全部直接生成，无 __createObject', async (t) => {
  const { ts: tsPath, dir } = await compileSource('obj-fast', `
plain = { k = 42, add(a, b) => a + b, $(x) => x };
computed = { v = (1 + 2) };
proto = { __proto__ = 7 };
Array of plain computed proto
`)
  const code = await fs.readFile(tsPath, 'utf8')
  if (!/Object\.freeze\(\{/.test(code)) {
    throw new Error(`字面量/方法对象应直接生成冻结字面量，实际:\n${code}`)
  }
  if (!/get "v"\(\)/.test(code)) {
    throw new Error(`计算绑定应生成对象字面量 getter，实际:\n${code}`)
  }
  if (/__createObject\(/.test(code)) {
    throw new Error(`对象构造不应再依赖 __createObject，实际:\n${code}`)
  }
  if (!CAN_RUN) return t.skip('Node <23 无原生类型剥离')
  const mod = await import(pathToFileURL(tsPath).href)
  const [plain, computed, proto] = mod.default
  const rt = await loadRuntime(dir)
  if (Object.getOwnPropertyDescriptor(plain, 'k')?.writable !== false) {
    throw new Error('字面量成员应保持只读 data property')
  }
  if (rt.__send(plain, 'add', [1, 2]) !== 3) throw new Error('方法应正常派发')
  if (rt.__send(plain, '$', [5]) !== 5) throw new Error('$ 应正常派发')
  if (computed.v !== 3) throw new Error('getter 首次读取应为 3')
  if (Object.getOwnPropertyDescriptor(computed, 'v')?.get == null) {
    throw new Error('计算绑定应编译为 getter')
  }
  if (Object.getPrototypeOf(proto) !== Object.prototype) {
    throw new Error('__proto__ 成员不能改写对象原型')
  }
  if (proto.__proto__ !== 7) throw new Error('__proto__ 应作为自有成员')
})

