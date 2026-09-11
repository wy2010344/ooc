// 引擎集成测试：验证 playground 的 engine/run 管线（Node 下跑，编译后 JS）。
// 浏览器差异只在 DOM/IndexedDB（ui.ui.dom / store），此处不触发。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sendMessage } from 'object-oriented-c-language'
import { createSignal } from 'wy-helper'
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
  // 信号一变就地重写文本/属性，事件属性不在其列。此处用 JS 直接喂函数等价模拟
  // OOC 里 `textContent => (signal get)` 的绑定。
  const sig = createSignal('苹果')
  class FakeNode {}
  const makeFakeEl = (tag: string) =>
    Object.assign(new FakeNode(), {
      tagName: tag.toUpperCase(),
      style: {} as Record<string, string>,
      children: [] as unknown[],
      parentNode: null,
      textContent: '',
      appendChild(n: unknown) {
        this.children.push(n)
        const node = n as { nodeType?: number; textContent?: string; parentNode?: unknown }
        node.parentNode = this
        if (node.nodeType === 3) this.textContent += String(node.textContent ?? '')
        return n
      },
    })
  const fakeDoc = {
    createElement: makeFakeEl,
    createTextNode(s: unknown) {
      // 文本节点也 instanceof FakeNode：Ctx._toNode 的 `instanceof Node` 判定才会
      // 直接挂载，否则会被 String() 二次包装成 '[object Object]'
      return Object.assign(new FakeNode(), {
        nodeType: 3,
        textContent: String(s),
      })
    },
  }
  const prevDoc = (globalThis as { document?: unknown }).document
  const prevNode = (globalThis as { Node?: unknown }).Node
  ;(globalThis as { document: unknown }).document = fakeDoc
  ;(globalThis as { Node: unknown }).Node = FakeNode
  try {
    const box = makeFakeEl('box') as unknown as {
      children: unknown[]
    }
    const ctx = new CtxI(box as never)
    // textContent 绑定一个读信号的回调 + 一个同样读信号的派生文本
    const fc = dom.div(
      { textContent: () => sig.get() },
      text.bind(() => '剩余 ' + sig.get() + ' 项'),
    )
    fc.apply(ctx)
    await tick()
    const div = box.children[0] as { children: unknown[]; textContent: string }
    const derive = div.children[0] as { nodeType: number; textContent: string }
    assert.equal(div.textContent, '苹果')
    assert.equal(derive.textContent, '剩余 苹果 项')

    sig.set('香蕉')
    await tick()
    assert.equal(div.textContent, '香蕉', 'textContent 绑定应随信号变化')
    assert.equal(derive.textContent, '剩余 香蕉 项', '派生文本应随信号变化')

    ctx.destroy()
    sig.set('梨')
    await tick()
    assert.equal(div.textContent, '香蕉', 'Ctx 销毁后订阅已清理，不再更新')
  } finally {
    ;(globalThis as { document: unknown }).document = prevDoc
    ;(globalThis as { Node?: unknown }).Node = prevNode
  }
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
  // 跑真实演示源码：createSignal + toSpliced 管道 + forEach 区域组件 + 受控输入框全链路。
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
    value: string
    checked: boolean
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
      value: '',
      checked: false,
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
    // 区域容器（display:contents）随组件的 [forEach apply] 挂在元素树相应位置，递归查找
    const findRegion = (n: unknown): FakeEl | null => {
      const node = n as { style?: Record<string, string>; children?: unknown[] }
      if (node.style?.display === 'contents') return n as FakeEl
      for (const c of node.children ?? []) {
        const hit = findRegion(c)
        if (hit) return hit
      }
      return null
    }
    const findInput = (n: unknown): FakeEl | null => {
      const node = n as { tagName?: string; children?: unknown[] }
      if (node.tagName === 'INPUT') return n as FakeEl
      for (const c of node.children ?? []) {
        const hit = findInput(c)
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

    // 初态：响应式列表区域为空，输入框是受控组件（value => newName 信号）
    const region = findRegion(box)
    assert.ok(region, '应创建 display:contents 的列表容器')
    assert.equal(region.children.length, 0, '初始列表应为空')
    const inputEl = findInput(box)
    assert.ok(inputEl, '应找到输入框')
    assert.equal(inputEl!.value, '', '受控输入框初始值来自信号')

    // 模拟输入：敲字触发 input 事件 → 受控绑定写回 newName 信号
    inputEl!.value = '新项目'
    inputEl!.handlers.input!({})
    await tick()

    // 点「添加一项」：读 newName 信号并清空信号，区域重建出 1 项
    const addBtn = findButton(box, '添加一项')
    assert.ok(addBtn, '应找到「添加一项」按钮')
    addBtn!.handlers.click!({})
    await tick()
    assert.equal(region.children.length, 1, '添加后列表应变 1 项')
    assert.ok(textOf(region).includes('新项目'), '应渲染出输入框里的名字')
    assert.equal(inputEl!.value, '', '添加后信号清空，受控输入框同步清空')

    // 点「删第一项」：/ toSpliced 0 1 删掉首个，区域重建回空
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

test('待办清单.ooc 演示：添加/切换完成/删除，信号驱动列表重建 + text bind 派生剩余数', async () => {
  // createSignal + forEach + toSpliced + 受控输入框（value => 信号）的组合拳：
  // 剩余项数用 text bind 派生文本（原地重写），列表区域响应 list 变化自动重建。
  class FakeNode {}
  type FakeEl = {
    tagName?: string
    style: Record<string, string>
    children: unknown[]
    parentNode: unknown
    textContent: string
    attrs: Record<string, unknown>
    handlers: Record<string, (e: unknown) => void>
    value: string
    checked: boolean
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
      value: '',
      checked: false,
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
  const findInput = (n: unknown): FakeEl | null => {
      const node = n as { tagName?: string; children?: unknown[] }
      if (node.tagName === 'INPUT') return n as FakeEl
      for (const c of node.children ?? []) {
        const hit = findInput(c)
        if (hit) return hit
      }
      return null
    }
  const fakeDoc = {
    createElement: makeFakeEl,
    createTextNode(s: unknown) {
      return Object.assign(new FakeNode(), {
        nodeType: 3,
        textContent: String(s),
      }) as unknown
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

    const regions: FakeEl[] = []
    const collectRegions = (n: unknown): void => {
      const node = n as { style?: Record<string, string>; children?: unknown[] }
      if (node.style?.display === 'contents') regions.push(n as FakeEl)
      for (const c of node.children ?? []) collectRegions(c)
    }
    collectRegions(box)
    // 「剩余 x 项」改成了 text bind 的派生文本（原地重写，不再占一个区域），
    // 响应式区域只剩列表区一个（挂在 [forEach apply] 所在元素树位置）
    assert.equal(regions.length, 1, '只剩列表一个响应式区域')
    const listReg = regions[0]!
    assert.ok(textOf(box).includes('剩余 1 项'), `初始剩余 1 项，实际: ${textOf(box)}`)
    assert.equal(listReg.children.length, 2, '初始 2 项')

    // 添加：受控输入框模拟输入（触发 input 事件写回 inputText 信号），点「添加」
    const inputEl = findInput(box)
    assert.ok(inputEl, '应找到受控输入框')
    assert.equal(inputEl!.value, '', '初始值来自 inputText 信号')
    inputEl!.value = '第三项'
    inputEl!.handlers.input!({})
    await tick()
    const addBtn = findButton(box, '添加')
    assert.ok(addBtn, '应找到「添加」按钮')
    addBtn!.handlers.click!({})
    await tick()
    assert.ok(textOf(box).includes('剩余 2 项'), `添加后剩 2 项，实际: ${textOf(box)}`)
    assert.equal(listReg.children.length, 3, '添加后 3 行')
    assert.ok(textOf(listReg).includes('第三项'), '应渲染出新项')
    assert.equal(inputEl!.value, '', '添加后信号清空，受控输入框同步清空')

    // 切换完成态：点某行的切换按钮（状态文字 [ ] → [x]），只改该行、剩余数 -1
    const rowToggle = findRow(listReg, '让列表响应信号')
    assert.ok(rowToggle, '应找到「让列表响应信号」行')
    const toggleBtn = (rowToggle!.children as FakeEl[]).find(
      (c) => c.tagName === 'BUTTON' && textOf(c).includes('[ ]'),
    )
    assert.ok(toggleBtn, '该行应有 [ ] 状态的切换按钮')
    toggleBtn!.handlers.click!({})
    await tick()
    assert.ok(textOf(box).includes('剩余 1 项'), `切换后剩 1 项，实际: ${textOf(box)}`)
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
    assert.ok(textOf(box).includes('剩余 1 项'), '删掉已完成项后剩余仍 1')
    assert.ok(!textOf(listReg).includes('让列表响应信号'), '该行已移除')

    ctx.destroy()
  } finally {
    ;(globalThis as { document: unknown }).document = prevDoc
    ;(globalThis as { Node?: unknown }).Node = prevNode
  }
})