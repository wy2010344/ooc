import type { StateHolderWithNode } from 'mve-core'
import { renderFDom, renderHtmlContent, renderTextContent } from 'mve-dom'
import type { GetValue } from 'wy-helper'

import { fc } from './fc.js'
import { ObjectValue } from 'object-oriented-c-language'

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
const makeTagFn = (tag: string): TagFactory => {
  return function (arg: any, ...children: DComponent[]) {
    //这里在 build 窗口已由调用方执行，属性按元信息分流
    return function (this: StateHolderWithNode<Node, readonly Node[]>) {
      const to: Record<string, unknown> = {}
      const meta = ObjectValue.metaOf(arg)
      if (meta) {
        meta.forEach(function (value, key) {
          const v = value[0]
          if (v.type == 'call') {
            // descriptor 分流：属性成员（getter，零参）每次读取重算（等价旧的
            // 每次调用），返回值（可为 lambda）原样透传给 mve；带参方法函数保持
            // bind（mve 按 SyncFun 调用，事件实参正常传入）
            const desc = Object.getOwnPropertyDescriptor(arg, key)
            if (desc && desc.get) {
              to[key] = () => arg[key]
            } else {
              to[key] = arg[key].bind(arg)
            }
          } else {
            // 常量值（bind getter），构造时读一次
            to[key] = arg[key]
          }
        })
      }
      return renderFDom(tag as any, {
        ...to,
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

function renderChildren(children: any, ctx: any) {
  children.forEach((child: any) => {
    if (Array.isArray(child)) {
      renderChildren(child, ctx)
    } else if (typeof child === 'string' || typeof child === 'number') {
      // 字面量字符串/数字直接渲染为文本节点，无需包 text apply
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