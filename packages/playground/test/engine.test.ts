// 引擎集成测试：验证 playground 的 engine/run 管线（Node 下跑，编译后 JS）。
// 浏览器差异只在 DOM/IndexedDB（ui.ui.dom / store），此处不触发。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sendMessage } from 'object-oriented-c-language'
import { createEngine, formatValue } from '../src/lib/engine.js'
import { runNote } from '../src/lib/run.js'
import { CtxI, createContext, type Fc } from '../src/lib/preview/ctx.js'
import { dom, fc, hasPreview, text } from '../src/lib/preview/dom.js'

const notes = () => [
  { name: 'main.ooc', source: 'math run 2 3\n' },
  {
    name: 'lib.ooc',
    source: 'math = {\n  run(a, b) => a + b\n};\nmath\n',
  },
]

test('createEngine 能解释并类型检查', async () => {
  const engine = createEngine(notes)
  const r = await runNote(
    engine,
    'main.ooc',
    '{ run(a, b) => a + b } run 2 3\n',
  )
  assert.equal(r.output, '5')
  assert.equal(r.error, null)
  const r2 = await runNote(engine, 'main.ooc', '1 + 2\n')
  assert.equal(r2.output, '3')
})

test('重复运行同名笔记不冲突', async () => {
  const engine = createEngine(notes)
  const a = await runNote(engine, 'main.ooc', '1 + 2\n')
  const b = await runNote(engine, 'main.ooc', '2 + 3\n')
  assert.equal(a.output, '3')
  assert.equal(b.output, '5')
  assert.equal(a.error, null)
  assert.equal(b.error, null)
})

test('#import 跨笔记可见', async () => {
  const engine = createEngine(notes)
  const r = await runNote(
    engine,
    'main.ooc',
    "lib = #import 'lib.ooc';\nlib run 2 3\n",
  )
  assert.equal(r.output, '5', `实际输出: ${r.output} 错误: ${r.error}`)
})

test('类型诊断捕获类型不匹配', async () => {
  const engine = createEngine(notes)
  const r = await runNote(engine, 'main.ooc', 'x: number = "hi"\n')
  assert.ok(
    r.diagnostics.some((d) => d.message.includes('类型不匹配')),
    `应有类型诊断, 实际: ${JSON.stringify(r.diagnostics)}`,
  )
})

test('语法错误被拦截为 error', async () => {
  const engine = createEngine(notes)
  const r = await runNote(engine, 'main.ooc', '1 + 2 ;;\n')
  assert.ok(r.error != null, '语法错误应写入 error')
})

test('formatValue 递归展开绑定', () => {
  const v = { a: 1 } as any
  v.b = function () {
    return 2
  }
  const s = formatValue(v)
  assert.ok(s.includes('a: 1'))
  assert.ok(s.includes('b: 2'))
})

test('演示笔记：注释+除法+无优先级左结合', async () => {
  const engine = createEngine(notes)
  // hello.ooc（用 ; 分隔顶层语句）
  const a = await runNote(engine, 'hello', "msg = 'hi';\nmsg |> toUpperCase\n")
  assert.equal(a.output, 'HI')
  // 算术.ooc（除法、取余、括号）
  const b = await runNote(
    engine,
    '算术',
    '1 + 2 * 3\n(1 + 2) * 3\n12 / 3\n7 % 3\n',
  )
  assert.notEqual(b.error, null, '缺 ; 的多条顶层语句应报语法错误')
})

test('preview 导出可识别，preview(ctx) 能收集节点并注册销毁回调', async () => {
  const engine = createEngine(notes)
  const r = await runNote(
    engine,
    '预演',
    "// 模块导出带 preview 的对象\n" +
      "obj = {\n" +
      "  preview(ctx){\n" +
      "    ctx addNode 'hello';\n" +
      "    ctx addDestroy [obj = 1];\n" +
      "  }\n" +
      "};\nobj\n",
  )
  assert.equal(r.error, null, r.error ?? '')
  assert.ok(hasPreview(r.value), '导出对象应带 preview 方法')

  const ctx = new CtxI(null) // 无挂载目标：addNode 收集到 nodes
  sendMessage(r.value, 'preview', [ctx])
  assert.deepEqual([...ctx.nodes.map(String)], ['hello'])
  assert.equal(ctx.destroyed, false)

  ctx.destroy()
  assert.equal(ctx.destroyed, true)
  assert.throws(() => ctx.addNode('again'), /已销毁/)
})

test('fc apply 带/不带 ctx 的两种组件调用形态', async () => {
  const engine = createEngine(notes)
  const r = await runNote(
    engine,
    '组件',
    "Comp = fc apply [ctx, a, b => ctx addDestroy [a + b]];\nComp\n",
  )
  assert.equal(r.error, null, r.error ?? '')

  // 不带 Ctx：返回惰性 FC（渲染时才执行组件体）
  const fc1 = sendMessage(r.value, 'apply', ['x', 1])
  assert.equal(typeof (fc1 as any).apply, 'function')

  // 带 Ctx：立即执行组件体（收集销毁回调）
  const ctx = new CtxI(null)
  sendMessage(fc1, 'apply', [ctx])
  assert.equal(ctx.destroyed, false)
  ctx.destroy()
  assert.equal(ctx.destroyed, true)
})

test('Ctx.provide/consume 沿子 Ctx 链可见', () => {
  const c = createContext('默认')
  const root = new CtxI(null)
  root.provide(c, '来自根')
  const sub = root.sub(null)
  assert.equal(sub.consume(c), '来自根')
  const nested = sub.sub(null)
  assert.equal(nested.consume(c), '来自根')
})

test('dom/text 桥接返回可渲染的 FC（渲染需要 DOM，Node 下跳过挂载）', () => {
  const fcDiv = dom.div({ className: 'box' }, text.apply('内容'))
  assert.equal(typeof fcDiv.apply, 'function')
  const fcText = fc.apply(() => undefined)
  assert.equal(typeof fcText.apply, 'function')
  // 不带 ctx 的消息调用（apply 传参）返回惰性 FC，不触发 document 访问
  const lazy = sendMessage(fcText, 'apply', ['x']) as Fc
  assert.equal(typeof lazy.apply, 'function')
})