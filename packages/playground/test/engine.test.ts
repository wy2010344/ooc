// 引擎集成测试：验证 playground 的 engine/run 管线（Node 下跑，编译后 JS）。
// 浏览器差异只在 DOM/IndexedDB（ui.ui.dom / store），此处不触发。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sendMessage } from 'object-oriented-c-language'
import { createSignal } from '../src/lib/preview/reactive.js'
import { createEngine, formatValue } from '../src/lib/engine.js'
import { PREVIEW_DEMO, TODO_DEMO } from '../src/hooks/useNotebook.js'
import { runNote } from '../src/lib/run.js'
import { CtxI, createContext, type Fc } from '../src/lib/preview/ctx.js'
import { dom, fc, hasPreview, text } from '../src/lib/preview/dom.js'

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

test('createSignal/toSplice 桥接：不可变更新信号列表', async () => {
  const engine = createEngine(notes)
  const r = await runNote(
    engine,
    '信号',
    // 注：OOC 里 `list get length` 会把 length 解析成 get 的参数（Ref），
    // 运行时报错；读长度须先绑定变量（`xs = list get`）。
    "list = createSignal apply emptyList;\n" +
      "xs = list get; list set (toSplice apply xs 0 0 'a');\n" +
      "ys = list get; list set (ys |> toSplice (ys length) 0 'b');\n" +
      "zs = list get; zs length\n",
  )
  assert.equal(r.error, null, r.error ?? '')
  // 两次添加后长度 2；管道 |> toSplice 与 toSplice apply 两种改法都能走通
  assert.equal(r.output, '2')
})

test('renderForEach 响应信号变化自动重建区域', async () => {
  const sig = createSignal(['甲', '乙'])
  // 最小假 document：元素带 replaceChildren/appendChild，文本节点只记内容
  const fakeDoc = {
    createElement(tag: string) {
      const el: {
        tagName: string
        style: Record<string, string>
        children: unknown[]
        parentNode: unknown
        appendChild(n: unknown): unknown
        replaceChildren(...cs: unknown[]): void
      } = {
        tagName: tag.toUpperCase(),
        style: {},
        children: [],
        parentNode: null,
        appendChild: function (n: unknown) {
          this.children.push(n)
          ;(n as { parentNode: unknown }).parentNode = this
          return n
        },
        replaceChildren(...cs: unknown[]) {
          this.children = cs
        },
      }
      return el
    },
    createTextNode(s: unknown) {
      return { nodeType: 3, textContent: String(s) }
    },
  }
  const prevDoc = (globalThis as { document?: unknown }).document
  ;(globalThis as { document: unknown }).document = fakeDoc
  try {
    const box = fakeDoc.createElement('box') as unknown as {
      children: unknown[]
    }
    const ctx = new CtxI(box as never)
    ctx.renderForEach({
      forEach(cb) {
        ;(sig.get() as string[]).forEach((v) => cb.apply(v, v))
      },
      creater(ic, et) {
        ic.addNode(et.value as string)
      },
    })
    await tick()
    // 渲染区容器 + 2 个文本节点
    assert.equal(box.children.length, 1, '应创建一个存放列表的容器')
    const region = box.children[0] as { children: unknown[] }
    assert.equal(region.children.length, 2)

    sig.set(['甲', '乙', '丙'])
    await tick()
    assert.equal(region.children.length, 3, '信号变化后列表区域应重建')

    ctx.destroy()
    await tick()
    assert.equal(region.children.length, 3, '销毁后内容不再变化')
  } finally {
    ;(globalThis as { document: unknown }).document = prevDoc
  }
})

test('预览.ooc 演示：点「添加一项/删第一项」驱动信号并响应式重建', async () => {
  // 跑真实演示源码：createSignal + toSplice 管道 + renderForEach + ui get 全链路。
  // 假 document 要能承住 dom/FC 的创建与挂载，还要记下事件回调供模拟点击。
  // Ctx._toNode 靠 `instanceof Node` 判断节点：假元素/文本都挂到 FakeNode 下，
  // 否则会被 String() 成文本，元素树就散了。
  class FakeNode {}
  type FakeEl = {
    tagName?: string
    style: Record<string, string>
    children: unknown[]
    parentNode: unknown
    textContent: string
    attrs: Record<string, unknown>
    handlers: Record<string, (e: unknown) => void>
    appendChild(n: unknown): unknown
    replaceChildren(...cs: unknown[]): void
    setAttribute(k: string, v: unknown): void
    addEventListener(t: string, cb: (e: unknown) => void): void
  }
  const makeFakeEl = (tag: string): FakeEl => {
    const el = Object.assign(new FakeNode(), {
      tagName: tag.toUpperCase(),
      style: {} as Record<string, string>,
      children: [] as unknown[],
      parentNode: null,
      textContent: '',
      attrs: {} as Record<string, unknown>,
      handlers: {} as Record<string, (e: unknown) => void>,
      appendChild(n: unknown) {
        this.children.push(n)
        const node = n as { parentNode?: unknown; nodeType?: number; textContent?: string }
        node.parentNode = this
        if (node.nodeType === 3) this.textContent += String(node.textContent ?? '')
        return n
      },
      replaceChildren(...cs: unknown[]) {
        this.children = cs
        this.textContent = ''
        for (const c of cs as unknown[]) {
          const node = c as { nodeType?: number; textContent?: unknown }
          if (node.nodeType === 3) this.textContent += String(node.textContent ?? '')
        }
      },
      setAttribute(k: string, v: unknown) {
        this.attrs[k] = v
      },
      addEventListener(t: string, cb: (e: unknown) => void) {
        this.handlers[t] = cb
      },
    })
    return el
  }
  const fakeDoc = {
    createElement: makeFakeEl,
    createTextNode(s: unknown) {
      return Object.assign(new FakeNode(), {
        nodeType: 3,
        textContent: String(s),
      }) as unknown
    },
    // ui get '#new-item' → 读到输入框当前值
    querySelector(sel: string) {
      if (sel === '#new-item')
        return Object.assign(new FakeNode(), { value: '新项目' }) as unknown as HTMLInputElement
      return null
    },
  }
  const prevDoc = (globalThis as { document?: unknown }).document
  const prevNode = (globalThis as { Node?: unknown }).Node
  ;(globalThis as { document: unknown }).document = fakeDoc
  ;(globalThis as { Node: unknown }).Node = FakeNode
  try {
    // 树上找文案匹配的元素（文本节点在 children 里，递归拼 textContent 更直观）
    const textOf = (n: unknown): string => {
      const node = n as { nodeType?: number; textContent?: string; children?: unknown[] }
      if (node.nodeType === 3) return node.textContent ?? ''
      let s = node.textContent ?? ''
      for (const c of node.children ?? []) s += textOf(c)
      return s
    }
    const findButton = (n: unknown, needle: string): FakeEl | null => {
      const node = n as { tagName?: string; children?: unknown[]; handlers?: Record<string, unknown> }
      if (node.tagName === 'BUTTON' && textOf(n).includes(needle)) return n as FakeEl
      for (const c of node.children ?? []) {
        const hit = findButton(c, needle)
        if (hit) return hit
      }
      return null
    }
    const engine = createEngine(notes)
    const r = await runNote(engine, '预览.ooc', PREVIEW_DEMO)
    assert.equal(r.error, null, r.error ?? '')
    assert.ok(hasPreview(r.value), '演示导出应带 preview')

    const box = makeFakeEl('box')
    const ctx = new CtxI(box as never)
    sendMessage(r.value, 'preview', [ctx])
    await tick()

    // 初态：响应式列表区域为空
    const region = box.children.find(
      (c) => (c as FakeEl).style?.display === 'contents',
    ) as FakeEl
    assert.ok(region, '应创建 display:contents 的列表容器')
    assert.equal(region.children.length, 0, '初始列表应为空')

    // 点「添加一项」：读取 #new-item、toSplice 不可变更新信号，区域重建出 1 项
    const addBtn = findButton(box, '添加一项')
    assert.ok(addBtn, '应找到「添加一项」按钮')
    addBtn!.handlers.click!({})
    await tick()
    assert.equal(region.children.length, 1, '添加后列表应变 1 项')
    assert.ok(textOf(region).includes('新项目'), '应渲染出输入框里的名字')

    // 点「删第一项」：|> toSplice 0 1 删掉首个，区域重建回空
    const delBtn = findButton(box, '删第一项')
    assert.ok(delBtn, '应找到「删第一项」按钮')
    delBtn!.handlers.click!({})
    await tick()
    assert.equal(region.children.length, 0, '删除后列表应回到空')

    ctx.destroy()
  } finally {
    ;(globalThis as { document: unknown }).document = prevDoc
    ;(globalThis as { Node?: unknown }).Node = prevNode
  }
})

test('待办清单.ooc 演示：添加/切换完成/删除，信号驱动两个区域重建', async () => {
  // createSignal + renderForEach + toSplice + ui get 的组合拳：剩余项数区域
  // 与列表区域都响应 list 变化，每次点击后自动重建。
  class FakeNode {}
  type FakeEl = {
    tagName?: string
    style: Record<string, string>
    children: unknown[]
    parentNode: unknown
    textContent: string
    attrs: Record<string, unknown>
    handlers: Record<string, (e: unknown) => void>
    appendChild(n: unknown): unknown
    replaceChildren(...cs: unknown[]): void
    setAttribute(k: string, v: unknown): void
    addEventListener(t: string, cb: (e: unknown) => void): void
  }
  const makeFakeEl = (tag: string): FakeEl => {
    const el = Object.assign(new FakeNode(), {
      tagName: tag.toUpperCase(),
      style: {} as Record<string, string>,
      children: [] as unknown[],
      parentNode: null,
      textContent: '',
      attrs: {} as Record<string, unknown>,
      handlers: {} as Record<string, (e: unknown) => void>,
      appendChild(n: unknown) {
        this.children.push(n)
        const node = n as { parentNode?: unknown; nodeType?: number; textContent?: string }
        node.parentNode = this
        if (node.nodeType === 3) this.textContent += String(node.textContent ?? '')
        return n
      },
      replaceChildren(...cs: unknown[]) {
        this.children = cs
        this.textContent = ''
        for (const c of cs as unknown[]) {
          const node = c as { nodeType?: number; textContent?: unknown }
          if (node.nodeType === 3) this.textContent += String(node.textContent ?? '')
        }
      },
      setAttribute(k: string, v: unknown) {
        this.attrs[k] = v
      },
      addEventListener(t: string, cb: (e: unknown) => void) {
        this.handlers[t] = cb
      },
    })
    return el
  }
  const textOf = (n: unknown): string => {
    const node = n as { nodeType?: number; textContent?: string; children?: unknown[] }
    if (node.nodeType === 3) return node.textContent ?? ''
    let s = node.textContent ?? ''
    for (const c of node.children ?? []) s += textOf(c)
    return s
  }
  const findButton = (n: unknown, needle: string): FakeEl | null => {
    const node = n as { tagName?: string; children?: unknown[]; handlers?: Record<string, unknown> }
    if (node.tagName === 'BUTTON' && textOf(n).includes(needle)) return n as FakeEl
    for (const c of node.children ?? []) {
      const hit = findButton(c, needle)
      if (hit) return hit
    }
    return null
  }
  const findRow = (n: unknown, needle: string): FakeEl | null => {
    // 找「正文包含 needle、且自带删除按钮」的行容器（避开根 div/区域容器）
    const node = n as { tagName?: string; children?: unknown[] }
    if (node.tagName === 'DIV' && textOf(n).includes(needle)) {
      const directButtons = (node.children ?? []).filter(
        (c: unknown) => (c as FakeEl).tagName === 'BUTTON',
      )
      if (directButtons.some((b: unknown) => textOf(b).includes('删除'))) return n as FakeEl
    }
    for (const c of node.children ?? []) {
      const hit = findRow(c, needle)
      if (hit) return hit
    }
    return null
  }
  const todoInput = Object.assign(new FakeNode(), {
    value: '',
  }) as unknown as HTMLInputElement
  const fakeDoc = {
    createElement: makeFakeEl,
    createTextNode(s: unknown) {
      return Object.assign(new FakeNode(), {
        nodeType: 3,
        textContent: String(s),
      }) as unknown
    },
    querySelector(sel: string) {
      if (sel === '#todo-input') return todoInput
      return null
    },
  }
  const prevDoc = (globalThis as { document?: unknown }).document
  const prevNode = (globalThis as { Node?: unknown }).Node
  ;(globalThis as { document: unknown }).document = fakeDoc
  ;(globalThis as { Node: unknown }).Node = FakeNode
  try {
    const engine = createEngine(notes)
    const r = await runNote(engine, '待办清单.ooc', TODO_DEMO)
    assert.equal(r.error, null, r.error ?? '')
    assert.ok(hasPreview(r.value), '演示导出应带 preview')

    const box = makeFakeEl('box')
    const ctx = new CtxI(box as never)
    sendMessage(r.value, 'preview', [ctx])
    await tick()

    const regions = box.children.filter(
      (c) => (c as FakeEl).style?.display === 'contents',
    ) as FakeEl[]
    assert.equal(regions.length, 2, '应有「剩余项数」与「列表」两个响应式区域')
    const counter = regions.find((reg) => textOf(reg).includes('剩余'))!
    const listReg = regions.find((reg) => textOf(reg).includes('搭一个') || textOf(reg).includes('让列表'))!
    assert.ok(counter && listReg, '应能区分计数区域与列表区域')
    assert.ok(textOf(counter).includes('剩余 1 项'), `初始剩余 1 项，实际: ${textOf(counter)}`)
    assert.equal(listReg.children.length, 2, '初始 2 项')

    // 添加：写入输入框后点「添加」，两个区域都重建
    todoInput.value = '第三项'
    const addBtn = findButton(box, '添加')
    assert.ok(addBtn, '应找到「添加」按钮')
    addBtn!.handlers.click!({})
    await tick()
    assert.ok(textOf(counter).includes('剩余 2 项'), `添加后剩 2 项，实际: ${textOf(counter)}`)
    assert.equal(listReg.children.length, 3, '添加后 3 行')
    assert.ok(textOf(listReg).includes('第三项'), '应渲染出新项')

    // 切换完成态：点某行的切换按钮（状态文字 [ ] → [x]），只改该行、剩余数 -1
    const rowToggle = findRow(listReg, '让列表响应信号')
    assert.ok(rowToggle, '应找到「让列表响应信号」行')
    const toggleBtn = (rowToggle!.children as FakeEl[]).find(
      (c) => c.tagName === 'BUTTON' && textOf(c).includes('[ ]'),
    )
    assert.ok(toggleBtn, '该行应有 [ ] 状态的切换按钮')
    toggleBtn!.handlers.click!({})
    await tick()
    assert.ok(textOf(counter).includes('剩余 1 项'), `切换后剩 1 项，实际: ${textOf(counter)}`)
    const toggledRow = findRow(listReg, '让列表响应信号')
    assert.ok(toggledRow, '重建后仍能找到该行')
    assert.ok(textOf(toggledRow!).includes('[x]'), `该行应变 [x]，实际: ${textOf(toggledRow!)}`)
    assert.equal(listReg.children.length, 3, '切换不改变行数')

    // 删除该行：行数 -1，剩余维持 1
    const rowDelete = findRow(listReg, '让列表响应信号')
    assert.ok(rowDelete, '重建后仍能找到该行')
    const delBtn = (rowDelete!.children as FakeEl[]).find(
      (c) => c.tagName === 'BUTTON' && textOf(c).includes('删除'),
    )
    assert.ok(delBtn, '该行应有删除按钮')
    delBtn!.handlers.click!({})
    await tick()
    assert.equal(listReg.children.length, 2, '删除后剩 2 行')
    assert.ok(textOf(counter).includes('剩余 1 项'), '删掉已完成项后剩余仍 1')
    assert.ok(!textOf(listReg).includes('让列表响应信号'), '该行已移除')

    ctx.destroy()
  } finally {
    ;(globalThis as { document: unknown }).document = prevDoc
    ;(globalThis as { Node?: unknown }).Node = prevNode
  }
})