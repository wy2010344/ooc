// 引擎集成测试：验证 playground 的 engine/run 管线（Node 下跑，编译后 JS）。
// 浏览器差异只在 DOM/IndexedDB，此处全部走假 DOM（fake-dom.ts）。预览挂载直接复用
// mve-dom 的 createRoot：构建窗口把 StateHolder 交给 preview(ctx)/组件（与 PreviewSheet 一致），
// 运行期 addNode 只收集不挂载，改界面一律走信号。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ObjectValue, sendMessage } from 'object-oriented-c-language'
import { createRoot } from 'mve-dom'
import type { StateHolderWithNode } from 'mve-core'
import { createEngine, formatValue } from '../src/lib/engine.js'
import { PREVIEW_DEMO, TODO_DEMO } from '../src/hooks/demos.js'
import { runNote } from '../src/lib/run.js'
import { dom, text } from '../src/lib/preview/dom.js'
import { fc } from '../src/lib/preview/fc.js'
import {
  FakeNode,
  findDivByText,
  findEl,
  isRowDiv,
  makeFakeEl,
  mountDoc,
  textOf,
} from './fake-dom.js'

/** 假 DOM 元素强转成浏览器 Node 类型（预览挂载的根容器入参） */
const asDomNode = (n: unknown) => n as unknown as globalThis.Node

/** 挂载到假容器：createRoot 构建窗口把 holder 交给 fn（对照 PreviewSheet 用法） */
const mountInto = (
  box: FakeNode,
  fn: (holder: StateHolderWithNode<Node, readonly Node[]>) => void,
): (() => void) =>
  createRoot(
    asDomNode(box),
    function (this: StateHolderWithNode<Node, readonly Node[]>) {
      fn(this)
    },
  )

/** 等一个宏任务，让 setTimeout(0) 的信号批次刷完 */
const tick = () => new Promise((r) => setTimeout(r, 0))

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

test('formatValue：宿主对象展开；OOC 定义对象按元信息展示', async () => {
  const v = { a: 1 } as any
  v.b = function () {
    return 2
  }
  const s = formatValue(v)
  assert.ok(s.includes('a: 1'))
  assert.ok(s.includes('b: 2'))

  const engine = createEngine(notes)
  const r = await runNote(
    engine,
    '展示',
    "o = { a => 1, name = 'x', cb(m) => m + 1 };\no\n",
  )
  const so = formatValue(r.value as never)
  assert.ok(so.includes('name: x'), `bind 显示缓存值, 实际: ${so}`)
  assert.ok(so.includes('a: (方法)'), `call 只标 (方法) 不执行, 实际: ${so}`)
  assert.ok(so.includes('cb: (方法)'), `方法成员只标 (方法), 实际: ${so}`)
})

test('演示笔记：注释+除法+无优先级左结合', async () => {
  const engine = createEngine(notes)
  // hello.ooc（用 ; 分隔顶层语句）
  const a = await runNote(engine, 'hello', "msg = 'hi';\nmsg / toUpperCase\n")
  assert.equal(a.output, 'HI')
  // 算术.ooc（除法、取余、括号）
  const b = await runNote(
    engine,
    '算术',
    '1 + 2 * 3\n(1 + 2) * 3\n12 div 3\n7 % 3\n',
  )
  assert.notEqual(b.error, null, '缺 ; 的多条顶层语句应报语法错误')
})

test('preview 导出可识别，holder addNode/addDestroy 生效', async () => {
  const engine = createEngine(notes)
  const r = await runNote(
    engine,
    '预演',
    '// 模块导出带 preview 的对象\n' +
      'obj = {\n' +
      '  preview(ctx){\n' +
      "    (text apply 'hello') / apply ctx;\n" +
      '    ctx addDestroy [obj = 1];\n' +
      '  }\n' +
      '};\nobj\n',
  )
  assert.equal(r.error, null, r.error ?? '')
  const meta = ObjectValue.metaOf(r.value)
  assert.ok(meta?.has('preview'), '导出对象应带 preview 方法')

  const unmount = mountDoc()
  try {
    const box = makeFakeEl('box')
    const dispose = mountInto(box, (holder) => {
      sendMessage(r.value, 'preview', [holder])
    })
    await tick()
    assert.equal(textOf(box), 'hello', '等信号批次刷完后 text 组件挂到 root')
    dispose() // 不抛错即 addDestroy 销毁回调注册成功
  } finally {
    unmount()
  }
})

test('fc apply 生成惰性组件，挂载期执行组件体', async () => {
  const engine = createEngine(notes)
  const r = await runNote(
    engine,
    '组件',
    'Comp = fc apply [ctx, a, b => ctx addDestroy [a + b]];\nComp\n',
  )
  assert.equal(r.error, null, r.error ?? '')
  const comp = sendMessage(r.value, 'apply', ['x', 1]) as (
    holder: unknown,
  ) => unknown
  assert.equal(typeof comp, 'function', '惰性 FC（渲染时才执行组件体）')

  const unmount = mountDoc()
  try {
    const box = makeFakeEl('box')
    const dispose = mountInto(box, (holder) => {
      comp(holder)
    })
    dispose()
  } finally {
    unmount()
  }
})

test('dom/text 桥接返回惰性组件', () => {
  const div = dom.div({ className: 'box' }, text('内容'))
  assert.equal(typeof div, 'function')
  const fcAny = fc(() => undefined)
  assert.equal(typeof fcAny, 'function')
})

test('createSignal + JS 数组生态：不可变更新信号列表', async () => {
  const engine = createEngine(notes)
  const r = await runNote(
    engine,
    '信号',
    // 注：OOC 里 `list get length` 会把 length 解析成 get 的参数（Ref），
    // 运行时报错；读长度须先绑定变量（`xs = list get`）。
    // Array 是 globalThis 全局对象，`(Array of)` 发 of 消息造空数组。
    'list = createSignal apply (Array of);\n' +
      "xs = list get; list set (xs / toSpliced 0 0 'a');\n" +
      "ys = list get; list set (ys / toSpliced (ys length) 0 'b');\n" +
      'zs = list get; zs length\n',
  )
  assert.equal(r.error, null, r.error ?? '')
  // 两次添加后长度 2；头部插入与追加都走 / toSpliced 级联调用数组原生方法
  assert.equal(r.output, '2')
})

test('预览.ooc 演示：点「添加一项/删第一项」驱动信号并响应式重建', async () => {
  // 跑真实演示源码：createSignal + toSpliced 管道 + forEach 区域组件 + 受控输入框全链路。
  const unmount = mountDoc()
  try {
    const engine = createEngine(notes)
    const r = await runNote(engine, '预览.ooc', PREVIEW_DEMO)
    assert.equal(r.error, null, r.error ?? '')
    assert.ok(ObjectValue.metaOf(r.value)?.has('preview'), '演示导出应带 preview')

    const box = makeFakeEl('box')
    const dispose = mountInto(box, (holder) => {
      sendMessage(r.value, 'preview', [holder])
    })
    await tick()

    const space = findDivByText(box, '组件示例')
    assert.ok(space, '应找到结构容器 div')

    // 列表行：单文本子节点的 div（forEach 区域直接挂容器的普通行）
    const itemRows = (): FakeNode[] =>
      (space!.children as FakeNode[]).filter(
        (c) =>
          c.tagName === 'DIV' &&
          c.children.length === 1 &&
          c.children[0].nodeType === 3,
      )

    // 初态：列表为空，输入框受控（value => (newName get) + onValueChange）
    assert.equal(itemRows().length, 0, '初始列表应为空')
    const inputEl = findEl(box, 'input')
    assert.ok(inputEl, '应找到输入框')
    assert.equal(
      inputEl!.value,
      '',
      '受控输入框初始值来自 value => (newName get)',
    )

    // 模拟输入：onValueChange 回调把输入框新值作为第一个参数传入
    inputEl!.handlers['valuechange']!('新项目')
    await tick()

    // 点「添加一项」：读 newName 信号并清空信号，区域重建出 1 项
    const addBtn = findEl(box, 'button', '添加一项')
    assert.ok(addBtn, '应找到「添加一项」按钮')
    addBtn!.handlers.click!({})
    await tick()
    assert.equal(itemRows().length, 1, '添加后列表应变 1 项')
    assert.ok(textOf(box).includes('新项目'), '应渲染出输入框里的名字')
    assert.equal(inputEl!.value, '', '添加后信号清空，受控输入框同步清空')

    // 点「删第一项」：/ toSpliced 0 1 删掉首个，区域重建回空
    const delBtn = findEl(box, 'button', '删第一项')
    assert.ok(delBtn, '应找到「删第一项」按钮')
    delBtn!.handlers.click!({})
    await tick()
    assert.equal(itemRows().length, 0, '删除后列表应回到空')

    dispose()
  } finally {
    unmount()
  }
})

test('待办清单.ooc 演示：添加/切换完成/删除，信号驱动列表重建 + text 派生剩余数', async () => {
  // createSignal + forEach + toSpliced + 受控输入框的组合拳：
  // 剩余项数用 text 派生文本（原地重写），列表区域响应 list 变化自动重建。
  const unmount = mountDoc()
  try {
    const engine = createEngine(notes)
    const r = await runNote(engine, '待办清单.ooc', TODO_DEMO)
    assert.equal(r.error, null, r.error ?? '')
    assert.ok(ObjectValue.metaOf(r.value)?.has('preview'), '演示导出应带 preview')

    const box = makeFakeEl('box')
    const dispose = mountInto(box, (holder) => {
      sendMessage(r.value, 'preview', [holder])
    })
    await tick()

    const space = findDivByText(box, '待办清单')
    assert.ok(space, '应找到结构容器 div')
    // 列表行：直接孩子里带「删除」按钮的 div（forEach 区域无额外容器）
    const rows = (): FakeNode[] =>
      (space!.children as FakeNode[]).filter((c) => isRowDiv(c))

    assert.ok(
      textOf(box).includes('剩余 1 项'),
      `初始剩余 1 项，实际: ${textOf(box)}`,
    )
    assert.equal(rows().length, 2, '初始 2 项')

    // 添加：受控输入框模拟输入（onInput 回调收事件对象取 target.value），点「添加」
    const inputEl = findEl(box, 'input')
    assert.ok(inputEl, '应找到受控输入框')
    assert.equal(inputEl!.value, '', '初始值来自 value => (inputText get)')
    inputEl!.value = '第三项'
    inputEl!.handlers.input!({ target: { value: '第三项' } })
    await tick()
    const addBtn = findEl(box, 'button', '添加')
    assert.ok(addBtn, '应找到「添加」按钮')
    addBtn!.handlers.click!({})
    await tick()
    assert.ok(
      textOf(box).includes('剩余 2 项'),
      `添加后剩 2 项，实际: ${textOf(box)}`,
    )
    assert.equal(rows().length, 3, '添加后 3 行')
    assert.ok(textOf(box).includes('第三项'), '应渲染出新项')
    assert.equal(inputEl!.value, '', '添加后信号清空，受控输入框同步清空')

    // 切换完成态：点某行的切换按钮（状态文字 [ ] → [x]），只改该行、剩余数 -1
    const rowToggle = rows().find((r2) => textOf(r2).includes('让列表响应信号'))
    assert.ok(rowToggle, '应找到「让列表响应信号」行')
    const toggleBtn = rowToggle!.children.find(
      (c) => c.tagName === 'BUTTON' && textOf(c).includes('[ ]'),
    )
    assert.ok(toggleBtn, '该行应有 [ ] 状态的切换按钮')
    toggleBtn!.handlers.click!({})
    await tick()
    assert.ok(
      textOf(box).includes('剩余 1 项'),
      `切换后剩 1 项，实际: ${textOf(box)}`,
    )
    const toggledRow = rows().find((r2) =>
      textOf(r2).includes('让列表响应信号'),
    )
    assert.ok(toggledRow, '重建后仍能找到该行')
    assert.ok(
      textOf(toggledRow!).includes('[x]'),
      `该行应变 [x]，实际: ${textOf(toggledRow!)}`,
    )
    assert.equal(rows().length, 3, '切换不改变行数')

    // 删除该行：行数 -1，剩余维持 1
    const rowDelete = rows().find((r2) => textOf(r2).includes('让列表响应信号'))
    assert.ok(rowDelete, '重建后仍能找到该行')
    const delBtn = rowDelete!.children.find(
      (c) => c.tagName === 'BUTTON' && textOf(c).includes('删除'),
    )
    assert.ok(delBtn, '该行应有删除按钮')
    delBtn!.handlers.click!({})
    await tick()
    assert.equal(rows().length, 2, '删除后剩 2 行')
    assert.ok(textOf(box).includes('剩余 1 项'), '删掉已完成项后剩余仍 1')
    assert.ok(!textOf(box).includes('让列表响应信号'), '该行已移除')

    dispose()
  } finally {
    unmount()
  }
})

test('ObjectValue 反射：OOC 定义值可读元信息', async () => {
  const engine = createEngine(notes)
  const r = await runNote(engine, '反射', 'p = {a => 1, b = 2};\np\n')
  assert.equal(r.error, null, r.error ?? '')
  const meta = ObjectValue.metaOf(r.value)
  assert.ok(meta, 'OOC 定义值应带元信息')
  assert.equal(meta!.get('a')?.[0].type, 'call')
  assert.equal(meta!.get('b')?.[0].type, 'bind')
  assert.equal(sendMessage(r.value, 'a', []), 1, 'call 成员仍可发消息调用')
  assert.equal(sendMessage(r.value, 'b', []), 2, 'bind 成员返回缓存值')
  assert.equal(ObjectValue.metaOf(42), undefined, '非定义值无元信息')
})