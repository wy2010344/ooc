import type { StateHolderWithNode } from 'mve-core'
import { renderFDom, renderHtmlContent, renderTextContent } from 'mve-dom'
import type { DomElementType } from 'wy-dom-helper'
import { domTagNames } from 'wy-dom-helper'

import { createOrProxy } from 'wy-helper'
import type { GetValue } from 'wy-helper'
import { fc } from './fc.js'
import { ObjectValue } from 'object-oriented-c-language'

//元素组件：第一个参数是属性对象，其余是子组件（DComponent）。
//调用时在 build 窗口内执行（this=StateHolder），经 renderFDom 挂到当前 holder。
export type DComponent = (
  ctx: StateHolderWithNode<Node, readonly Node[]>,
) => unknown

export const dom: {
  readonly [key in DomElementType]: (
    props?: unknown,
    ...children: DComponent[]
  ) => DComponent
} = createOrProxy(domTagNames, (tag) => {
  return function (arg: any, ...children: DComponent[]) {
    //这里在 build 窗口已由调用方执行，属性按元信息分流
    return function (this: StateHolderWithNode<Node, readonly Node[]>) {
      const to: Record<string, unknown> = {}
      const meta = ObjectValue.metaOf(arg)
      if (meta) {
        meta.forEach(function (value, key) {
          const v = value[0]
          if (v.type == 'call') {
            //是函数（事件回调/动态 getter），交给 mve 当 SyncFun
            to[key] = arg[key].bind(arg)
          } else {
            //是常量值，构造时读一次
            to[key] = arg[key]()
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
})

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
