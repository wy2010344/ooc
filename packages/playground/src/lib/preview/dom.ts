/**
 * 预览的 DOM 侧桥接：把 OOC 成员对象翻译成 wy-dom-helper 的 fdom 属性，交给 renderFDomAttr。
 * - fc apply [closure]：closure 形如 [ctx, a, b => ...]，第一个参数固定是 Ctx；
 *   组件有两种调用形态：`Comp apply ctx a b`（立即渲染）与 `Comp apply a b`（返回惰性 FC，由父元素渲染时再执行）。
 * - dom.<tag> props children...：props 为 OOC 对象。成员是「方法派发函数」，
 *   不能裸塞给 fdom（fdom 会把函数当 SyncFun 裸调）。桥接层靠 ObjectValue 元信息
 *   判定每个成员：bind（`=` 构造时缓存）→ 求值一次直接赋值，不建立观察（同 mve-dom 静态路径）；
 *   call/mutable（`=>` 方法等）→ transform 成 SyncFun，用 mve-core 的 hookTrackAttr 跟踪
 *   绑定读到的信号，变化后在 addEffect 派发的 effects（level -1）里原地重写。
 *   受控输入：value/checked 单向显示绑定 + 光标保护（只有值不相等才写属性）；
 *   用户输入不回写，写回走 React 式 `onValueChange(v) => 信号 set v`（回调入参即输入框新值）。
 *   事件：`onXxx` 是「事件即方法」——成员是方法，宿主把它当回调调用并把事件/新值作为第一个形参传入。
 * - text bind <值>/<λ> 渲染文本：λ 视为响应式派生（collectSignal，信号一变就原地重写）。
 * 本文件除元素生成外不碰 DOM：渲染发生在 FC.apply（构建期），Node 下安全。
 */

import { invoke, ObjectValue } from 'object-oriented-c-language'
import { hookTrackAttr } from 'mve-core'
import { renderFDomAttr } from 'wy-dom-helper'
import type { MergeValue } from 'wy-dom-helper'
import { collectSignal } from 'wy-helper'
import { createContext, isFc, type Ctx, type Fc } from './ctx.js'

export type { Ctx, Fc as FC }
export { createContext } from './ctx.js'

/** 模块导出值是否带 preview(ctx) 方法（决定编辑器是否显示"预览"入口） */
export function hasPreview(v: unknown): boolean {
  return (
    !!v &&
    typeof v === 'object' &&
    typeof (v as Record<string, unknown>).preview === 'function'
  )
}

/**
 * 惰性组件工厂：
 * - 直接调 `fc.apply(ctx, ...)` → 立即执行；
 * - 其它（如 `Comp apply a b`）→ 记住参数，返回「渲染时再执行」的 FC。
 */
function makeFc(run: (ctx: Ctx, args: unknown[]) => unknown): Fc {
  return {
    apply(...args) {
      // 第一个参数是预览上下文（旧 instanceof 判定放宽为结构判断）
      if (
        args.length &&
        args[0] &&
        typeof (args[0] as Ctx).addNode === 'function'
      ) {
        return run(args[0] as Ctx, args.slice(1))
      }
      return { apply: (ctx: Ctx) => run(ctx, args) }
    },
  }
}

/** 宿主对象 fc：`fc apply [closure]` 返回组件 FC */
export const fc = {
  apply(closure: unknown): Fc {
    return makeFc((ctx, args) => invoke(closure, [ctx, ...args]))
  },
}

const TAG_NAMES = [
  'div', 'span', 'p', 'a', 'img', 'input', 'button', 'select', 'textarea',
  'label', 'ul', 'li', 'ol', 'h1', 'h2', 'h3', 'h4', 'h5', 'pre', 'code',
  'strong', 'em', 'form', 'table', 'thead', 'tbody', 'tr', 'td', 'th',
  'section', 'article', 'header', 'footer', 'nav', 'main', 'aside',
]

function requireDocument(): typeof document {
  if (typeof document === 'undefined') {
    throw new Error('DOM 渲染需要在浏览器环境')
  }
  return document
}

/** dom.<tag>(props?, ...children)：返回会创建元素 + 挂载子节点的 FC。
 *  标签集固定，构造时一次性生成各方法，不需要 Proxy。 */
function domTag(tag: string) {
  return (props?: unknown, ...children: unknown[]): Fc =>
    makeFc((ctx) => {
      const doc = requireDocument()
      const el = doc.createElement(tag)
      // 子渲染上下文：children 在 el holder 的构建窗口内 addNode（mve renderChildren 接管挂载）
      ctx.sub(el as unknown as globalThis.Node, (sub) => {
        applyProps(el, props, tag)
        for (const c of children) sub.addNode(c)
      })
    })
}

export const dom = Object.fromEntries(
  TAG_NAMES.map((tag) => [tag, domTag(tag)]),
) as Record<string, (props?: unknown, ...children: unknown[]) => Fc>

/** text bind <值> 渲染文本；值是函数/FC（OOC λ 或 { apply(ctx){...} }）时视为
 *  响应式派生文本：求值时读到的信号一变就重新求值改写节点内容。普通值即静态文本。 */
function textFc(args: unknown[]): Fc {
  return makeFc((ctx) => {
    const node = requireDocument().createTextNode('')
    const v = args.length ? args[0] : ''
    if (typeof v === 'function' || isFc(v)) {
      // 可调用值：作为派生文本，包 collectSignal 订阅读到的信号，变化后重写文本
      const derive = () => {
        const out = typeof v === 'function' ? v() : invoke(v, [])
        node.textContent = String(out ?? '')
      }
      const collector = collectSignal(derive)
      collector.collect(derive)
      ctx.onDispose(() => collector.destroy())
    } else {
      node.textContent = String(v ?? '')
    }
    ctx.addNode(node)
  })
}

export const text = {
  bind: (...args: unknown[]): Fc => textFc(args),
}

/** forEach apply <区域对象> → 组件。区域对象形如
 *   { forEach(block){...}, creater(itemCtx, et, key){...} }（即原 Ctx.renderForEach 的参数）。
 *  渲染时委托 Ctx.renderForEach（mve keyed diff），不必自己拿到 ctx 再调。 */
export const forEach = {
  apply(region?: unknown): Fc {
    return makeFc((ctx) => {
      ctx.renderForEach(region as never)
    })
  },
}

/** 上下文工厂：context.create <默认值> → Context（配 Ctx.provide/consume 使用） */
export const context = {
  create<T>(value: T) {
    return createContext(value)
  },
}

/**
 * 受控组件判断：input/textarea/select 的 value、input 的 checked（checkbox/radio）
 * 走属性直写（value 属性 ≠ value attribute，attribute 只设默认值）。
 */
function isControllable(tag: string, key: string): boolean {
  if (key === 'checked') return tag === 'input'
  if (key === 'value') return tag === 'input' || tag === 'textarea' || tag === 'select'
  return false
}

/** 执行 OOC 事件成员：this=对象调用，若返回可调用值再塞同一个事件/新值执行 */
function emitMember(src: Record<string, unknown>, raw: unknown, ev: unknown) {
  let out: unknown
  if (typeof raw === 'function') {
    out = raw.call(src, ev)
  } else if (isFc(raw)) {
    out = invoke(raw, [ev])
  }
  if (isFc(out) || typeof out === 'function') invoke(out, [ev])
}

/** 读 OOC 成员绑定：成员是方法派发函数，必须 this=对象调用得到绑定值（每次重新求值） */
function readMember(src: Record<string, unknown>, raw: unknown): unknown {
  return typeof raw === 'function' ? raw.call(src) : raw
}

/** 受控 value/checked：成员绑定值写属性，值没变就不写（光标保护） */
function makeWriteSyncFun(
  src: Record<string, unknown>,
  raw: unknown,
  key: string,
) {
  if (key === 'checked') {
    return (set: (v: unknown, n: unknown, k?: string) => void, node: { checked: boolean }) => {
      const b = !!readMember(src, raw)
      if (node.checked !== b) set(b, node, 'checked')
    }
  }
  return (set: (v: unknown, n: unknown, k?: string) => void, node: { value: string }) => {
    const s = String(readMember(src, raw) ?? '')
    if (node.value !== s) set(s, node, 'value')
  }
}

/** style：成员返回对象 → 逐键展开；静态字符串直接写 */
function makeStyleSyncFun(
  src: Record<string, unknown>,
  raw: unknown,
) {
  return (
    set: (v: unknown, n: unknown, k: string) => void,
    node: { style: Record<string, string> },
  ) => {
    const so = readMember(src, raw)
    if (so && typeof so === 'object') {
      const st = so as Record<string, unknown>
      for (const k of Object.keys(st)) {
        const v =
          typeof st[k] === 'function'
            ? (st[k] as () => unknown).call(st)
            : st[k]
        node.style[k] = String(v ?? '')
      }
    } else if (typeof so === 'string') {
      set(so, node, 'style')
    }
  }
}

/**
 * 把 OOC 对象的成员 transform 成 fdom 属性后交给 renderFDomAttr：
 * - 成员类型来自 ObjectValue 元信息（构造时烧录，guard 重载已折叠）：
 *   bind（`=`）是构造时缓存的一次性静态值 → readMember 一次直接赋值，不建立观察；
 *   call/mutable（`=>` 方法/可写绑定）每次调用重新求值 → 转 SyncFun，由 oocMergeValue
 *   用 hookTrackAttr 跟踪其读到的信号（变化后 effects 批次里重写，时机与 mve-dom 一致）；
 * - 事件成员（on* 前缀）→ 手工 addEventListener（this=对象，返回可调用值再执行）；
 *   onValueChange 转 input 事件并传新值；
 * - 受控 value/checked → makeWriteSyncFun（单向显示 + 光标保护）；
 * - style → makeStyleSyncFun（对象展开/字符串直写）；
 * - 宿主侧已解析的值 → 原样传给 renderFDomAttr。
 */
function applyProps(el: Element, props: unknown, tag: string): void {
  if (!props || typeof props !== 'object') return
  const src = props as Record<string, unknown>
  // 元信息判定每个 key 的静态/动态；宿主对象无元信息时退回全动态处理
  const kinds = new Map(
    ObjectValue.membersOf(props).map((m) => [m.name, m.type]),
  )
  const attrs: Record<string, unknown> = {}
  for (const key of Object.keys(src)) {
    const raw = src[key]
    if (key === 'onValueChange') {
      const el2 = el as unknown as { value: string }
      el.addEventListener('input', () => {
        try {
          emitMember(src, raw, el2.value)
        } catch (err) {
          console.error('预览 onValueChange 出错', err)
        }
      })
      continue
    }
    if (key.startsWith('on') && key.length > 2) {
      const eventType = key.slice(2).toLowerCase()
      el.addEventListener(eventType, (e: Event) => {
        try {
          emitMember(src, raw, e)
        } catch (err) {
          console.error('预览事件处理出错', err)
        }
      })
      continue
    }
    if (isControllable(tag, key)) {
      attrs[key] = makeWriteSyncFun(src, raw, key)
      continue
    }
    if (key === 'style') {
      attrs[key] = makeStyleSyncFun(src, raw)
      continue
    }
    if (typeof raw === 'function') {
      if (kinds.get(key) === 'bind') {
        // 静态绑定：构造时缓存，一次性赋值，不建立观察（贴近 mve-dom）
        attrs[key] = readMember(src, raw)
      } else {
        // 动态成员（call/mutable）：转 SyncFun，由 oocMergeValue 跟踪信号
        attrs[key] = (set: (v: unknown, n: unknown, k: string) => void, node: Element, k: string) =>
          set(raw.call(src), node, k)
      }
    } else {
      attrs[key] = raw
    }
  }
  // on* 事件键已在上面消费，留给 renderFDomAttr 的全是属性
  renderFDomAttr(el as unknown as Node, attrs, oocMergeValue, noopRenderPortal, [])
}

const noopRenderPortal = () => {}

/**
 * 属性合并：与 mve-dom mergeValue 同构——非函数（bind 静态值/宿主静态值）一次性 setValue；
 * 函数（动态成员的 SyncFun 包装）首次写一次后，用 hookTrackAttr 跟踪其读到的信号，
 * 信号变化时在 effects 批次（level -1，构建期注册、构建后统一派发）里重写属性。
 * 需要构建期（隐式 holder 在位）调用：applyProps 都发生在 FC.apply（构建期）。
 */
const oocMergeValue: MergeValue = (
  node: Node,
  value: any,
  setValue: any,
  ext?: string,
) => {
  if (typeof value !== 'function') {
    setValue(value, node, ext)
    return
  }
  // 首次写一次，再用 hookTrackAttr 订阅信号变化（变化后由 collector 再调 value 重写）
  value(setValue, node, ext)
  hookTrackAttr(
    () => {
      value(setValue, node, ext)
      return undefined
    },
    () => {},
  )
}

export { isFc }