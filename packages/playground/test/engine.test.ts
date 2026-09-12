// 引擎集成测试：验证 playground 的 engine/run 管线（Node 下跑，编译后 JS）。
// 浏览器差异只在 DOM/IndexedDB（ui.ui.dom / store），此处不触发。
// mountPreview 的 mve 语义：createRoot 的 build 回调在 mve 的 buildChildren 窗口里执行，
// provide/renderForEach/元素挂载都发生在其中（构建期），运行期 addNode 只收集不挂载。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sendMessage } from 'object-oriented-c-language'
import { createSignal } from 'wy-helper'
import { createEngine, formatValue } from '../src/lib/engine.js'
import { PREVIEW_DEMO, TODO_DEMO } from '../src/hooks/useNotebook.js'
import { runNote } from '../src/lib/run.js'
import { mountPreview, createContext, type Fc } from '../src/lib/preview/ctx.js'
import { dom, fc, hasPreview, text } from '../src/lib/preview/dom.js'
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

  const unmount = mountDoc()
  try {
    // 构建窗口里 preview(ctx)：字符串 → 文本节点挂到根容器
    const box = makeFakeEl('box')
    let api: { destroyed: boolean; addNode(...v: unknown[]): void } | undefined
    const mount = mountPreview(asDomNode(box), (c) => {
      api = c
      sendMessage(r.value, 'preview', [c])
    })
    await tick()
    assert.equal(textOf(box), 'hello')
    assert.equal(api!.destroyed, false)

    mount.destroy()
    assert.equal(api!.destroyed, true)
    assert.throws(() => api!.addNode('again'), /无法再继续添加/)
  } finally {
    unmount()
  }
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

  // 带 Ctx：立即执行组件体（收集销毁回调），挂到假 DOM 无副作用
  const unmount = mountDoc()
  try {
    const box = makeFakeEl('box')
    const mount = mountPreview(asDomNode(box), (c) => {
      sendMessage(fc1, 'apply', [c])
    })
    mount.destroy()
  } finally {
    unmount()
  }
})

test('Ctx.provide/consume 沿子 Ctx 链可见', () => {
  const c = createContext('默认')
  const unmount = mountDoc()
  try {
    const box = makeFakeEl('box')
    const mount = mountPreview(asDomNode(box), (root) => {
      root.provide(c, '来自根')
      root.sub(null, (sub) => {
        assert.equal(sub.consume(c), '来自根')
        sub.sub(null, (nested) => {
          assert.equal(nested.consume(c), '来自根')
        })
      })
    })
    mount.destroy()
  } finally {
    unmount()
  }
})

test('dom/text 桥接返回可渲染的 FC（渲染需要 DOM，Node 下跳过挂载）', () => {
  const fcDiv = dom.div({ className: 'box' }, text.bind('内容'))
  assert.equal(typeof fcDiv.apply, 'function')
  const fcText = fc.apply(() => undefined)
  assert.equal(typeof fcText.apply, 'function')
  // 不带 ctx 的消息调用（apply 传参）返回惰性 FC，不触发 document 访问
  const lazy = sendMessage(fcText, 'apply', ['x']) as Fc
  assert.equal(typeof lazy.apply, 'function')
})

test('createSignal + JS 数组生态：不可变更新信号列表', async () => {
  const engine = createEngine(notes)
  const r = await runNote(
    engine,
    '信号',
    // 注：OOC 里 `list get length` 会把 length 解析成 get 的参数（Ref），
    // 运行时报错；读长度须先绑定变量（`xs = list get`）。
    // Array 是 globalThis 全局对象，`(Array of)` 发 of 消息造空数组。
    "list = createSignal apply (Array of);\n" +
      "xs = list get; list set (xs / toSpliced 0 0 'a');\n" +
      "ys = list get; list set (ys / toSpliced (ys length) 0 'b');\n" +
      "zs = list get; zs length\n",
  )
  assert.equal(r.error, null, r.error ?? '')
  // 两次添加后长度 2；头部插入与追加都走 / toSpliced 级联调用数组原生方法
  assert.equal(r.output, '2')
})

test('响应式 text/textContent：props 读到的信号变化后文本原地更新', async () => {
  // dom/text 桥接层：给 props/text 传函数值即视为「派生」——包 collectSignal 求值，
  // 信号一变就地重写文本/属性。事件属性不在其列。此处用 JS 直接喂函数等价模拟
  // OOC 里 `textContent => (signal get)` 的绑定。挂载发生在 mountPreview 的 build 窗口。
  const sig = createSignal('苹果')
  const unmount = mountDoc()
  try {
    const box = makeFakeEl('box')
    const mount = mountPreview(asDomNode(box), (c) => {
      const fc = dom.div(
        { textContent: () => sig.get() },
        text.bind(() => '剩余 ' + sig.get() + ' 项'),
      )
      fc.apply(c)
    })
    await tick()
    const div = box.children[0] as FakeNode
    assert.equal(div.tagName, 'DIV')
    const derive = div.children[0] as FakeNode
    assert.equal(div.textContent, '苹果')
    assert.equal(derive.textContent, '剩余 苹果 项')

    sig.set('香蕉')
    await tick()
    assert.equal(div.textContent, '香蕉', 'textContent 绑定应随信号变化')
    assert.equal(derive.textContent, '剩余 香蕉 项', '派生文本应随信号变化')

    mount.destroy()
    sig.set('梨')
    await tick()
    assert.equal(div.textContent, '香蕉', 'Ctx 销毁后订阅已清理，不再更新')
  } finally {
    unmount()
  }
})

test('renderForEach 响应信号变化自动重建区域', async () => {
  const sig = createSignal(['甲', '乙'])
  const unmount = mountDoc()
  try {
    const box = makeFakeEl('box')
    const mount = mountPreview(asDomNode(box), (c) => {
      c.renderForEach({
        forEach(cb) {
          ;(sig.get() as string[]).forEach((v) => cb.apply(v, v))
        },
        creater(ic, et) {
          ic.addNode(et.value as string)
        },
      })
    })
    await tick()
    // 列表项直接挂在 box 下（mve 不再有 display:contents 区域容器）
    assert.equal(box.children.length, 2, '两个文本项直接挂载')
    assert.ok((box.children[0] as FakeNode).nodeType === 3)

    sig.set(['甲', '乙', '丙'])
    await tick()
    assert.equal(box.children.length, 3, '信号变化后列表应重建')

    mount.destroy()
    await tick()
    assert.equal(box.children.length, 3, '销毁后内容不再变化')
  } finally {
    unmount()
  }
})

test('预览.ooc 演示：点「添加一项/删第一项」驱动信号并响应式重建', async () => {
  // 跑真实演示源码：createSignal + toSpliced 管道 + forEach 区域组件 + 受控输入框全链路。
  // 假 document 要能承住 dom/FC 的创建与挂载，还要记下事件回调供模拟点击。
  const unmount = mountDoc()
  try {
    const engine = createEngine(notes)
    const r = await runNote(engine, '预览.ooc', PREVIEW_DEMO)
    assert.equal(r.error, null, r.error ?? '')
    assert.ok(hasPreview(r.value), '演示导出应带 preview')

    const box = makeFakeEl('box')
    const mount = mountPreview(asDomNode(box), (c) => {
      sendMessage(r.value, 'preview', [c])
    })
    await tick()

    const space = findDivByText(box, '组件示例')
    assert.ok(space, '应找到结构容器 div')

    // 列表行：单文本子节点的 div（forEach 区域直接挂容器的普通行）
    const itemRows = (): FakeNode[] =>
      (space!.children as FakeNode[]).filter(
        (c) => c.tagName === 'DIV' && c.children.length === 1 && c.children[0].nodeType === 3,
      )

    // 初态：列表为空，输入框受控（value => (newName get) + onValueChange）
    assert.equal(itemRows().length, 0, '初始列表应为空')
    const inputEl = findEl(box, 'input')
    assert.ok(inputEl, '应找到输入框')
    assert.equal(inputEl!.value, '', '受控输入框初始值来自 value => (newName get)')

    // 模拟输入：敲字触发 input 事件 → onValueChange 回调收新值并写回 newName
    inputEl!.value = '新项目'
    inputEl!.handlers.input!({})
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

    mount.destroy()
  } finally {
    unmount()
  }
})

test('待办清单.ooc 演示：添加/切换完成/删除，信号驱动列表重建 + text bind 派生剩余数', async () => {
  // createSignal + forEach + toSpliced + 受控输入框的组合拳：
  // 剩余项数用 text bind 派生文本（原地重写），列表区域响应 list 变化自动重建。
  const unmount = mountDoc()
  try {
    const engine = createEngine(notes)
    const r = await runNote(engine, '待办清单.ooc', TODO_DEMO)
    assert.equal(r.error, null, r.error ?? '')
    assert.ok(hasPreview(r.value), '演示导出应带 preview')

    const box = makeFakeEl('box')
    const mount = mountPreview(asDomNode(box), (c) => {
      sendMessage(r.value, 'preview', [c])
    })
    await tick()

    const space = findDivByText(box, '待办清单')
    assert.ok(space, '应找到结构容器 div')
    // 列表行：直接孩子里带「删除」按钮的 div（forEach 区域无额外容器）
    const rows = (): FakeNode[] =>
      (space!.children as FakeNode[]).filter((c) => isRowDiv(c))

    assert.ok(textOf(box).includes('剩余 1 项'), `初始剩余 1 项，实际: ${textOf(box)}`)
    assert.equal(rows().length, 2, '初始 2 项')

    // 添加：受控输入框模拟输入（触发 onValueChange 回调写回 inputText），点「添加」
    const inputEl = findEl(box, 'input')
    assert.ok(inputEl, '应找到受控输入框')
    assert.equal(inputEl!.value, '', '初始值来自 value => (inputText get)')
    inputEl!.value = '第三项'
    inputEl!.handlers.input!({})
    await tick()
    const addBtn = findEl(box, 'button', '添加')
    assert.ok(addBtn, '应找到「添加」按钮')
    addBtn!.handlers.click!({})
    await tick()
    assert.ok(textOf(box).includes('剩余 2 项'), `添加后剩 2 项，实际: ${textOf(box)}`)
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
    assert.ok(textOf(box).includes('剩余 1 项'), `切换后剩 1 项，实际: ${textOf(box)}`)
    const toggledRow = rows().find((r2) => textOf(r2).includes('让列表响应信号'))
    assert.ok(toggledRow, '重建后仍能找到该行')
    assert.ok(textOf(toggledRow!).includes('[x]'), `该行应变 [x]，实际: ${textOf(toggledRow!)}`)
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

    mount.destroy()
  } finally {
    unmount()
  }
})

test('ObjectValue �Žӣ�OOC ����ж���ֵ�����Ա��', async () => {
  const engine = createEngine(notes)
  const r = await runNote(
    engine,
    '����',
    'ObjectValue isDefined {a => 1}\n',
  )
  assert.equal(r.error, null, r.error ?? '')
  assert.equal(r.output, 'true')
  const r2 = await runNote(
    engine,
    '����',
    'p = {a => 1};\nc = {...p, b => 2};\nObjectValue messagesOf c / length\n',
  )
  assert.equal(r2.error, null, r2.error ?? '')
  assert.equal(r2.output, '2')
})


test('���Է�����bind ��̬һ���Ը�ֵ��call ��Ա���ź���д', async () => {
  const engine = createEngine(notes)
  const r = await runNote(
    engine,
    '����',
"r = createSignal apply 'on';\n" +
      "box = {\n" +
      "  className = 'static-x',\n" +
      "  title => r get,\n" +
      "  onClick => r set 'off'\n" +
      "};\nbox\n",
  )
  assert.equal(r.error, null, r.error ?? '')
  const box = r.value as Record<string, unknown>
  const unmount = mountDoc()
  try {
    const root = makeFakeEl('root')
    const mount = mountPreview(asDomNode(root), (c) => {
      dom.div(box).apply(c)
    })
    await tick()
    const div = root.children[0] as FakeNode
    // bind��`= ����ʱ���棩��ֱ̬д��call��`=>`�����źŹ��ɶ�̬��
    assert.equal(
      (div as unknown as { className: string }).className,
      'static-x',
    )
    assert.equal((div as unknown as { title: string }).title, 'on')
    // ������̬�¼����źű仯�󣬶�̬ title ��д��bind className ���ֹ���ʱֵ
    div.handlers.click!({})
    await tick()
    assert.equal((div as unknown as { title: string }).title, 'off')
    assert.equal(
      (div as unknown as { className: string }).className,
      'static-x',
    )
    mount.destroy()
  } finally {
    unmount()
  }
})
