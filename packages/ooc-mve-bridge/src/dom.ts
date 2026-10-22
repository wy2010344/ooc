import type { StateHolderWithNode } from 'mve-core'
import { renderFDom, renderFSvg, renderHtmlContent, renderTextContent } from 'mve-dom'
import type { GetValue } from 'wy-helper'

import { fc } from './fc.js'

//元素组件：第一个参数是属性对象，其余是子组件（DComponent）。
//调用时在 build 窗口内执行（this=StateHolder），经 renderFDom 挂到当前 holder。
export type DComponent = (
  ctx: StateHolderWithNode<Node, readonly Node[]>,
) => unknown

//标签构造器：接收 (props?, ...lambda children)，返回 DComponent（挂载期执行组件体）
export type TagFactory = (
  props?: unknown,
  ...children: DComponent[]
) => DComponent

//宽泛元素：任意标签名都可调用（TS 侧 Proxy 暴露方法，接受 lambda children），
//未知标签在类型上静默退化为 any（见 type-checker），运行时经 Proxy 动态创建，
//不依赖语言级 methodNotFound——methodNotFound 让位给 JS Proxy 的动态派发。
/** 把 OOC 属性对象的 descriptor 分流成 mve 认识的 props（数据属性/函数/事件）。 */
function propsOf(arg: unknown): Record<string, unknown> {
  const to: Record<string, unknown> = {}
  if (!arg || typeof arg !== 'object') return to
  for (const key of Object.keys(arg)) {
    const desc = Object.getOwnPropertyDescriptor(arg, key)
    if (!desc) continue
    if (desc.get || desc.set) {
      // 计算绑定（getter）：惰性一次缓存，读一次（常量语义）
      to[key] = (arg as Record<string, unknown>)[key]
    } else if (typeof desc.value === 'function') {
      // 方法/转发器（只读数据函数）：绑到接收者。零参方法 → GetValue（每次读重算）；
      // 带参方法 → 事件处理器（mve 传入事件实参）
      to[key] = desc.value.bind(arg)
    } else {
      // 字面量绑定值 / 宿主属性：原样透传
      to[key] = (arg as Record<string, unknown>)[key]
    }
  }
  return to
}

const makeTagFn = (tag: string): TagFactory => {
  return function (arg: any, ...children: DComponent[]) {
    //这里在 build 窗口已由调用方执行，属性按 descriptor 分流
    return function (this: StateHolderWithNode<Node, readonly Node[]>) {
      return renderFDom(tag as any, {
        ...propsOf(arg),
        children() {
          renderChildren(children, this)
        },
      }) as any
    }
  }
}

// SVG 同理，但走 createElementNS 的 renderFSvg；mve-dom 自带的 svg 只接收 props，
// 不支持子节点，OOC 侧需要统一的 (props?, ...children) 标签调用形态。
const makeSvgTagFn = (tag: string): TagFactory => {
  return function (arg: any, ...children: DComponent[]) {
    return function (this: StateHolderWithNode<Node, readonly Node[]>) {
      return renderFSvg(tag as any, {
        ...propsOf(arg),
        children() {
          renderChildren(children, this)
        },
      }) as any
    }
  }
}

const tagFns = new Map<string, TagFactory>()

export const dom: { readonly [tag: string]: TagFactory } = new Proxy(
  Object.create(null) as Record<string, TagFactory>,
  {
    get(_target, tag) {
      if (typeof tag !== 'string') return undefined
      let fn = tagFns.get(tag)
      if (!fn) {
        fn = makeTagFn(tag)
        tagFns.set(tag, fn)
      }
      return fn
    },
  },
)

const svgTagFns = new Map<string, TagFactory>()

export const svg: { readonly [tag: string]: TagFactory } = new Proxy(
  Object.create(null) as Record<string, TagFactory>,
  {
    get(_target, tag) {
      if (typeof tag !== 'string') return undefined
      let fn = svgTagFns.get(tag)
      if (!fn) {
        fn = makeSvgTagFn(tag)
        svgTagFns.set(tag, fn)
      }
      return fn
    },
  },
)

function renderChildren(children: any, ctx: any) {
  children.forEach((child: any) => {
    if (Array.isArray(child)) {
      renderChildren(child, ctx)
    } else if (typeof child === 'string' || typeof child === 'number') {
      // 字面量字符串/数字直接渲染为文本节点，无需包 text $
      renderTextContent(String(child))
    } else {
      child(ctx)
    }
  })
}

export const text = fc(function (_ctx, value: string | GetValue<string>) {
  renderTextContent(value)
})

export const html = fc(function (_ctx, value: string | GetValue<string>) {
  renderHtmlContent(value)
})

// 把一串 DComponent 渲染进当前 holder（供 floating/portal 等自行建元素的桥接复用）。
export function renderComponents(children: any, ctx: any) {
  renderChildren(children, ctx)
}