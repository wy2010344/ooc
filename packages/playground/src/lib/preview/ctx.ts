/**
 * 预览用的最小 Ctx 实现：参考 mve-core 的 StateHolder，但只保留「一次构建」语义。
 * 信号式响应渲染（keyed diff / 重渲染）暂不实现：renderForEach 静态渲染一次。
 * 本文件不触碰 DOM：addNode 在有挂载目标时插入，否则收集到 nodes（便于 Node 下测试）。
 */

import { invoke } from 'object-oriented-c-language'
import { collectSignal } from './reactive.js'

/** 上下文：provide/consume 按对象身份在父子 Ctx 链上查找 */
export interface Context<T> {
  provide(v: T): T
  consume(): T
}

export class ContextI<T> implements Context<T> {
  constructor(readonly value: T) {}
  provide(v: T): T {
    return v
  }
  consume(): T {
    return this.value
  }
}

/** 渲染回调（FC）：OOC 里写成 { apply(ctx) {...} } 或 fc apply [ctx,...] */
export interface Fc {
  apply(ctx: Ctx, ...args: unknown[]): unknown
}

export interface ForEachCb<T, K, O> {
  apply(key: K, value: T): { apply(): O }
}

export interface ForEachArg<T, K, O> {
  // 宿主侧提供 forEach（如 JS 数组的 forEach），OOC 侧提供 creater
  forEach(cb: ForEachCb<T, K, O>): void
  creater(ctx: Ctx, et: { key: K; index: number; value: T }, key: K): O
}

/** OOC 里 Ctx 的类型面：addNode / addDestroy / provide / consume / renderForEach */
export interface Ctx {
  addNode(...vs: unknown[]): void
  addDestroy(fn: Fc): void
  provide<T>(context: Context<T>, value: T): void
  consume<T>(context: Context<T>): T
  readonly destroyed: boolean
  readonly nodes: ReadonlyArray<unknown>
  renderForEach<T, K = T, O = unknown>(
    o: ForEachArg<T, K, O>,
  ): { apply(): unknown }
}

interface NodeLike {
  appendChild(n: unknown): unknown
}

/** 渲染区容器：真实 DOM div 或测试假元素的最小面 */
interface RenderBox {
  appendChild(n: unknown): unknown
  replaceChildren?(...ns: unknown[]): void
  children?: unknown[]
  style?: Record<string, string>
  parentNode?: unknown
}

export function createContext<T>(value: T): Context<T> {
  return new ContextI<T>(value)
}

/** FC 判断：带 apply 方法的对象（含 OOC lambda） */
export function isFc(v: unknown): v is Fc {
  return (
    !!v &&
    typeof v === 'object' &&
    typeof (v as Fc).apply === 'function'
  )
}

/**
 * 根 Ctx：挂载目标为容器元素（可空，空则只收集 nodes）。
 * 每个 FC 渲染时新建子 Ctx（挂到其元素下），provide/consume 沿父链查找。
 */
export class CtxI implements Ctx {
  private readonly _nodes: unknown[] = []
  private readonly _destroyList: Fc[] = []
  private readonly _dispose: Array<() => void> = []
  private readonly _contexts: [Context<unknown>, unknown][] = []
  private _destroyed = false

  constructor(
    private readonly _target: (NodeLike & globalThis.Node) | null = null,
    readonly parent?: CtxI,
    private readonly parentCtxIndex: number = parent?._contexts.length ?? 0,
  ) {}

  get destroyed(): boolean {
    return this._destroyed
  }

  get nodes(): ReadonlyArray<unknown> {
    return this._nodes
  }

  /** 子 Ctx：挂载目标由调用方指定（如 dom 元素内部） */
  sub(target: globalThis.Node | null): CtxI {
    return new CtxI(target, this)
  }

  addNode(...vs: unknown[]): void {
    this._ensureAlive('addNode')
    for (const v of vs) {
      if (isFc(v)) {
        // FC 直接在此 Ctx 上渲染（挂到 target；无 target 时收集）
        v.apply(this)
      } else if (this._target) {
        this._target.appendChild(this._toNode(v))
      } else {
        this._nodes.push(v)
      }
    }
  }

  addDestroy(fn: Fc): void {
    this._ensureAlive('addDestroy')
    this._destroyList.push(fn)
  }

  destroy(): void {
    if (this._destroyed) return
    this._destroyed = true
    // 先释放响应式订阅，再逆序执行销毁回调（与 mve 一致）
    for (const fn of this._dispose) {
      try {
        fn()
      } catch {
        // 订阅清理失败不影响整体销毁流程
      }
    }
    this._dispose.length = 0
    for (let i = this._destroyList.length - 1; i >= 0; i--) {
      invoke(this._destroyList[i], [])
    }
  }

  provide<T>(context: Context<T>, value: T): void {
    this._contexts.push([context as Context<unknown>, value])
  }

  consume<T>(context: Context<T>): T {
    const found = this._findProvider(context)
    if (found) return found as unknown as T
    return context.consume()
  }

  renderForEach<T, K = T, O = unknown>(
    o: ForEachArg<T, K, O>,
  ): { apply(): unknown } {
    this._ensureAlive('renderForEach')
    // 有 DOM 与挂载目标时：整段渲染放进一个不改布局的容器（display:contents），
    // 用 collectSignal 登记本次渲染读到的信号；任一信号变化后整段重建。
    // 信号流：list = createSignal apply emptyList → 渲染读 list get →
    // 事件里 list set (toSplice apply (list get) …) → 本区域自动刷新。
    const me = this
    const doc = globalThis.document
    if (doc && this._target) {
      let container: RenderBox | null = null
      const renderRegion = () => {
        if (me._destroyed) return
        if (!container || container.parentNode !== me._target) {
          const box = doc.createElement('div') as unknown as RenderBox
          if (box.style) box.style.display = 'contents'
          me._target!.appendChild(box)
          container = box
        }
        if (container.replaceChildren) {
          container.replaceChildren()
        } else if (container.children) {
          ;(container.children as unknown[]).length = 0
        }
        let index = 0
        o.forEach({
          apply(key: K, value: T) {
            // 子项挂进同一容器，但各有自己的 Ctx（provide/consume 独立链）
            if (!me._destroyed) {
              const itemCtx = new CtxI(container as unknown as NodeLike & globalThis.Node, me)
              o.creater(itemCtx, { key, index, value }, key)
            }
            index++
            return { apply(): O { return undefined as unknown as O } }
          },
        })
      }
      const collector = collectSignal(() => renderRegion())
      collector.collect(() => renderRegion())
      me._dispose.push(() => {
        try {
          collector.destroy()
        } catch {
          // 订阅可能已在分批刷新中失效，忽略
        }
      })
    } else {
      // 无 DOM/目标（Node 测试、仅收集）：静态渲染一次，等同旧行为
      let index = 0
      o.forEach({
        apply(key: K, value: T) {
          const itemCtx = new CtxI(me._target, me)
          void o.creater(itemCtx, { key, index: index++, value }, key)
          return { apply(): O { return undefined as unknown as O } }
        },
      })
    }
    return { apply(): unknown { return undefined } }
  }

  private _findProvider<T>(context: Context<T>): T | undefined {
    let holder: CtxI | undefined = this
    let begin = holder._contexts.length
    while (holder) {
      for (let i = begin - 1; i > -1; i--) {
        const pair = holder._contexts[i]
        if (pair[0] === context) return pair[1] as T
      }
      begin = holder.parentCtxIndex
      holder = holder.parent
    }
    return undefined
  }

  private _ensureAlive(op: string): void {
    if (this._destroyed) {
      throw new Error(`Ctx 已销毁，不能再${op}`)
    }
  }

  private _toNode(v: unknown): globalThis.Node {
    if (typeof globalThis.Node !== 'undefined' && v instanceof globalThis.Node) {
      return v
    }
    if (typeof document === 'undefined') {
      throw new Error('元素插入需要浏览器环境')
    }
    return document.createTextNode(String(v))
  }
}