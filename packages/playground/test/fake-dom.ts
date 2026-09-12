/**
 * Node 测试用的最小假 DOM：mve-dom 的 diffMove 需要
 * insertBefore/removeChild/nextSibling/firstChild/parentNode，
 * 事件绑定需要 addEventListener，受控输入需要 value/checked。
 * FakeNode 同时挂在 globalThis.Node 上，供文档相关判定使用。
 */
export class FakeNode {
  nodeType = 0
  parentNode: FakeNode | null = null
  previousSibling: FakeNode | null = null
  nextSibling: FakeNode | null = null
  children: FakeNode[] = []
  textContent = ''
  tagName = ''
  style: Record<string, string> = {}
  attrs: Record<string, unknown> = {}
  handlers: Record<string, (e: unknown) => void> = {}
  value = ''
  checked = false

  private _recalcText(): void {
    this.textContent = this.children
      .map((c) => (c.nodeType === 3 ? c.textContent : ''))
      .join('')
  }

  appendChild(node: FakeNode): FakeNode {
    this.insertBefore(node, null)
    return node
  }

  replaceChildren(...cs: FakeNode[]): void {
    for (const c of this.children) c.parentNode = null
    this.children = []
    for (const c of cs) this.insertBefore(c, null)
  }

  insertBefore(node: FakeNode, ref: FakeNode | null): void {
    if (node.parentNode) {
      node.parentNode.removeChild(node)
    }
    node.parentNode = this
    const idx = ref ? this.children.indexOf(ref) : -1
    if (idx < 0) {
      this.children.push(node)
    } else {
      this.children.splice(idx, 0, node)
    }
    // 同步兄弟链，保持真实 DOM 语义（diffMove 依赖 nextSibling 定位插入点）
    const prev = this.children[this.children.indexOf(node) - 1] ?? null
    const next = this.children[this.children.indexOf(node) + 1] ?? null
    node.previousSibling = prev
    node.nextSibling = next
    if (prev) prev.nextSibling = node
    if (next) next.previousSibling = node
    this._recalcText()
  }

  removeChild(node: FakeNode): void {
    const idx = this.children.indexOf(node)
    if (idx >= 0) {
      this.children.splice(idx, 1)
      // 兄弟指针让相邻节点互连
      const prev = this.children[idx - 1] ?? null
      const next = this.children[idx] ?? null
      if (prev) prev.nextSibling = next
      if (next) next.previousSibling = prev
    } else {
      // 不在 children（可能是 detached）也要清理指向自己的引用
      if (node.nextSibling) node.nextSibling.previousSibling = node.previousSibling
      if (node.previousSibling) node.previousSibling.nextSibling = node.nextSibling
    }
    if (node.parentNode === this) node.parentNode = null
    node.previousSibling = null
    node.nextSibling = null
    this._recalcText()
  }

  setAttribute(k: string, v: unknown): void {
    this.attrs[k] = v
  }

  addEventListener(t: string, cb: (e: unknown) => void): void {
    this.handlers[t] = cb
  }
}

export type FEl = FakeNode

/** 文本节点（nodeType 3） */
export function makeTextNode(s: unknown): FakeNode {
  return Object.assign(new FakeNode(), {
    nodeType: 3,
    textContent: String(s ?? ''),
  })
}

/** 元素节点（nodeType 1）：tagName 大写 */
export function makeFakeEl(tag: string): FakeNode {
  return Object.assign(new FakeNode(), {
    nodeType: 1,
    tagName: tag.toUpperCase(),
  })
}

export function makeDocument(): {
  createElement: (tag: string) => FakeNode
  createTextNode: (s: unknown) => FakeNode
} {
  return {
    createElement: makeFakeEl,
    createTextNode: makeTextNode,
  }
}

/** 在 globalThis 上临时挂假 document / Node，返回恢复函数 */
export function mountDoc(): () => void {
  const g = globalThis as unknown as {
    document?: unknown
    Node?: unknown
  }
  const prevDoc = g.document
  const prevNode = g.Node
  g.document = makeDocument()
  g.Node = FakeNode
  return () => {
    g.document = prevDoc
    g.Node = prevNode
  }
}

/** 递归拼接节点文本（含后代） */
export function textOf(n: FakeNode | unknown): string {
  const node = n as FakeNode
  if (node.nodeType === 3) return node.textContent
  let s = ''
  for (const c of node.children) s += textOf(c)
  return s
}

/** 深度优先找 tagName 匹配的元素（可带文本过滤） */
export function findEl(
  n: FakeNode,
  tag: string,
  needle?: string,
): FakeNode | null {
  if (n.tagName === tag.toUpperCase()) {
    if (!needle || textOf(n).includes(needle)) return n
  }
  for (const c of n.children) {
    const hit = findEl(c, tag, needle)
    if (hit) return hit
  }
  return null
}

/** 找"正文包含 needle 的 DIV"（避开按钮/输入等叶元素） */
export function findDivByText(n: FakeNode, needle: string): FakeNode | null {
  if (n.tagName === 'DIV' && textOf(n).includes(needle)) return n
  for (const c of n.children) {
    const hit = findDivByText(c, needle)
    if (hit) return hit
  }
  return null
}

/** 直接子元素里带"删除"按钮的行容器 */
export function isRowDiv(n: FakeNode): boolean {
  return (
    n.tagName === 'DIV' &&
    n.children.some(
      (c) => c.tagName === 'BUTTON' && textOf(c).includes('删除'),
    )
  )
}

/** 统计容器里直接挂着的行容器（列表重建后用于对比数量） */
export function rowCount(n: FakeNode): number {
  return n.children.filter(isRowDiv).length
}