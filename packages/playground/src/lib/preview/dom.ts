/**
 * 预览的 DOM 侧桥接：把 mve-dom 的「dom 也是 FC」入口缩小到 playground 能用的范围。
 * - fc apply [closure]：closure 形如 [ctx, a, b => ...]，第一个参数固定是 Ctx；
 *   组件有两种调用形态：`Comp apply ctx a b`（立即渲染）与 `Comp apply a b`（返回惰性 FC，由父元素渲染时再执行）。
 * - dom.<tag> props children...：props 为 OOC 对象（`=>` 绑定），children 为 FC/文本。
 *   input/textarea/select 的 value（及 checkbox 的 checked）绑定「信号对象」时是受控组件：
 *   显示 signal.get、用户输入写回 signal.set（双向绑定），读值走信号，不再 querySelector 强读。
 * - text bind <值>/<λ> 渲染文本：λ 视为响应式派生（读到的信号一变就原地重写）。
 * 标签与文本都直接生成普通 JS 对象，不用 Proxy：方法名固定、可枚举、便于调试。
 * 本文件除元素生成外不碰 DOM：渲染发生在 FC.apply，Node 下安全。
 */

import { invoke } from 'object-oriented-c-language'
import { collectSignal } from 'wy-helper'
import { CtxI, isFc, type Ctx, type Fc } from './ctx.js'

export type { Ctx, Fc as FC }
export { CtxI } from './ctx.js'

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
function makeFc(run: (ctx: CtxI, args: unknown[]) => unknown): Fc {
  return {
    apply(...args) {
      if (args.length && args[0] instanceof CtxI) {
        return run(args[0], args.slice(1))
      }
      return { apply: (ctx: CtxI) => run(ctx, args) }
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
      applyProps(el, props, ctx, tag)
      const sub = ctx.sub(el)
      for (const c of children) sub.addNode(c)
      ctx.addNode(el)
    })
}

export const dom = Object.fromEntries(
  TAG_NAMES.map((tag) => [tag, domTag(tag)]),
) as Record<string, (props?: unknown, ...children: unknown[]) => Fc>

/** text bind <值> 渲染文本；值是函数/FC（OOC λ 或 { apply(ctx){...} }）时视为
 *  响应式派生文本：求值时读到的信号一变就重新求值改写节点内容。普通值即静态文本。
 *  单个方法对象命名清晰（bind），不需要 Proxy，也不需要叫 apply。 */
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
 *  渲染时内部调用 Ctx.renderForEach 整段渲染区域，不必自己拿到 ctx 再调。
 *  信号感应：区域内读到的信号一变，整段区域自动重建。 */
export const forEach = {
  apply(region?: unknown): Fc {
    return makeFc((ctx) => {
      ;(ctx as unknown as { renderForEach(o: unknown): unknown }).renderForEach(region)
    })
  },
}

/** 上下文工厂：context.create <默认值> → Context（配 Ctx.provide/consume 使用） */
export const context = {
  create<T>(value: T) {
    return { provide: () => value, consume: () => value } as {
      provide(v: T): T
      consume(): T
    }
  },
}

/**
 * 受控组件判断：input/textarea/select 的 value、input 的 checked（checkbox/radio）
 * 绑定「信号对象」时升级为受控。仅这两个键/标签组合走属性直写 + 双向写回。
 */
function isControllable(tag: string, key: string): boolean {
  if (key === 'checked') return tag === 'input'
  if (key === 'value') return tag === 'input' || tag === 'textarea' || tag === 'select'
  return false
}

/** 信号对象判定：{ get(), set() }（createSignal 的返回形态） */
function isSignalLike(v: unknown): v is { get(): unknown; set(v: unknown): void } {
  return (
    !!v &&
    typeof v === 'object' &&
    typeof (v as { get?: unknown }).get === 'function' &&
    typeof (v as { set?: unknown }).set === 'function'
  )
}

/**
 * 把 OOC 对象的 `=>` 绑定写进元素：className/style/事件/样式键(s_)/attr。
 * 响应式：非事件属性用 collectSignal 包裹每次取值——`attrs[key]` 取到的是成员
 * 派发函数，每次取都会重新求值绑定表达式，因此绑定期读到的信号一变就
 * 就地重写该属性（如 `textContent => (signal get)` 会自动跟随）。事件属性
 * 不走更新通道（点击时执行即可，订阅反而多余）。订阅随子 Ctx 销毁而清理。
 * 受控组件：value/checked 走 isControllable 分支——绑定值为信号对象时，
 * 显示 signal.get（变化跟随），输入/变更事件写回 signal.set（双向）。
 */
function applyProps(el: Element, props: unknown, ctx: CtxI, tag: string): void {
  if (!props || typeof props !== 'object') return
  const attrs = props as Record<string, unknown>
  for (const key of Object.keys(attrs)) {
    const raw = attrs[key]
    // 受控 value/checked：属性直写（value 属性 ≠ value attribute，attribute 只设默认值），
    // 绑定信号对象时用户输入写回信号；静态值（如 value => 'abc'）只写一次不反写。
    if (isControllable(tag, key)) {
      const el2 = el as unknown as { value: string; checked: boolean }
      let sink: ((v: unknown) => void) | null = null
      const write = () => {
        const bound = typeof raw === 'function' ? raw.call(attrs) : raw
        const sig = isSignalLike(bound) ? bound : null
        sink = sig ? sig.set : null
        const next = sig ? sig.get() : bound
        if (key === 'checked') {
          const b = !!next
          if (el2.checked !== b) el2.checked = b
        } else {
          const s = String(next ?? '')
          // 值没变就不写属性：输入期间 signal.get 通常等于 el.value，
          // 跳过赋值可保住光标位置
          if (el2.value !== s) el2.value = s
        }
      }
      const collector = collectSignal(write)
      collector.collect(write)
      el.addEventListener(key === 'checked' ? 'change' : 'input', () => {
        if (sink) sink(key === 'checked' ? el2.checked : el2.value)
      })
      ctx.onDispose(() => collector.destroy())
      continue
    }
    // 事件属性：OOC 成员本身是方法（MethodAll），`attrs[key]` 取出的是成员派发函数，
    // 所以每次事件调用一次即可——OOC 里可直接写 `onClick => toggle apply (et index)`。
    // 老写法（绑定值是一个 λ）也兼容：调用派发函数拿到 λ 后再次 invoke 执行。
    if (key.startsWith('on') && key.length > 2) {
      el.addEventListener(key.slice(2).toLowerCase(), (e: Event) => {
        try {
          if (typeof raw === 'function') {
            const out = raw.call(attrs, e)
            // out 可能是 FC 对象或原生函数型 λ（isFc 只认 object，原生函数需单独判）
            if (isFc(out) || typeof out === 'function') invoke(out, [e])
          } else if (isFc(raw)) {
            invoke(raw, [e])
          }
        } catch (err) {
          console.error('预览事件处理出错', err)
        }
      })
      continue
    }
    const write = () => {
      // OOC 对象成员是方法：非事件属性调用一次得到绑定值（每次重新求值）
      let value = typeof raw === 'function' ? raw.call(attrs) : raw
      if (key === 'style') {
        if (typeof value === 'string') {
          el.setAttribute('style', value)
        } else {
          const st = (el as HTMLElement).style as unknown as Record<string, string>
          for (const k of Object.keys((value as Record<string, unknown>) ?? {})) {
            st[k] = String((value as Record<string, unknown>)[k])
          }
        }
      } else if (key.startsWith('s_')) {
        // 前缀 s_ 的键直接写样式：s_cursor=>'pointer' → style.cursor
        const st = (el as HTMLElement).style as unknown as Record<string, string>
        st[key.slice(2)] = String(value)
      } else if (key === 'className') {
        el.setAttribute('class', String(value))
      } else if (key === 'textContent') {
        el.textContent = String(value)
      } else {
        el.setAttribute(key, String(value))
      }
    }
    // 立即写一次，并把绑定期读到的信号登记为依赖：变化后原地重写
    const collector = collectSignal(write)
    collector.collect(write)
    ctx.onDispose(() => collector.destroy())
  }
}

export { isFc }