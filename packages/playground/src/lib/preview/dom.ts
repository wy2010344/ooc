/**
 * 预览的 DOM 侧桥接：把 mve-dom 的「dom 也是 FC」入口缩小到 playground 能用的范围。
 * - fc apply [closure]：closure 形如 [ctx, a, b => ...]，第一个参数固定是 Ctx；
 *   组件有两种调用形态：`Comp apply ctx a b`（立即渲染）与 `Comp apply a b`（返回惰性 FC，由父元素渲染时再执行）。
 * - dom.<tag> props children...：props 为 OOC 对象（`=>` 绑定），children 为 FC/文本。
 * - text <名> 渲染字面文本；text apply <值> 渲染值。
 * 本文件除元素生成外不碰 DOM：渲染发生在 FC.apply，Node 下安全。
 */

import { invoke } from 'object-oriented-c-language'
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

/** dom.<tag>(props?, ...children)：返回会创建元素 + 挂载子节点的 FC */
export const dom = new Proxy({} as Record<string, (props?: unknown, ...children: unknown[]) => Fc>, {
  get(_t, key) {
    if (typeof key !== 'string') return undefined
    const tag = key.toLowerCase()
    if (!TAG_NAMES.includes(tag)) {
      throw new Error(`dom 不支持的元素: ${tag}`)
    }
    return (props?: unknown, ...children: unknown[]) =>
      makeFc((ctx) => {
        const doc = requireDocument()
        const el = doc.createElement(tag)
        applyProps(el, props)
        const sub = ctx.sub(el)
        for (const c of children) sub.addNode(c)
        ctx.addNode(el)
      })
  },
})

/** text <名> 渲染字面文本；text apply <值> 渲染 String(值) */
export const text = new Proxy({} as Record<string, (...args: unknown[]) => Fc>, {
  get(_t, name) {
    if (typeof name !== 'string') return undefined
    return (...args: unknown[]) =>
      makeFc((ctx) => {
        const content = args.length ? String(args[0]) : String(name)
        ctx.addNode(requireDocument().createTextNode(content))
      })
  },
})

/** 上下文工厂：context.create <默认值> → Context（配 Ctx.provide/consume 使用） */
export const context = {
  create<T>(value: T) {
    return { provide: () => value, consume: () => value } as {
      provide(v: T): T
      consume(): T
    }
  },
}

/** 把 OOC 对象的 `=>` 绑定写进元素：className/style/事件/样式键(s_)/attr */
function applyProps(el: Element, props: unknown): void {
  if (!props || typeof props !== 'object') return
  const attrs = props as Record<string, unknown>
  for (const key of Object.keys(attrs)) {
    let value = attrs[key]
    // OOC 对象成员是方法：调用一次得到绑定值
    if (typeof value === 'function') value = value.call(attrs)
    if (key.startsWith('on') && key.length > 2) {
      // 事件：收到事件后调用 OOC lambda（[e => ...]）
      el.addEventListener(key.slice(2).toLowerCase(), (e: Event) => {
        try {
          invoke(value, [e])
        } catch (err) {
          console.error('预览事件处理出错', err)
        }
      })
    } else if (key === 'style') {
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
}

export { isFc }