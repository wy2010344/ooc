import { EachTime, StateHolder, StateHolderWithNode } from 'mve-core'
import { GetValue } from 'wy-helper'

/**
 * 组件包装：f 的第一个形参是 ctx（StateHolder，构建期可用 addNode/addDestroy），
 * 其余是用户实参。fc apply <arg>... 生成惰性组件（(ctx) => …），挂载期再执行 f。
 * 与 preview/dom.ts 的 DComponent 一致：调用方传 (ctx: unknown) 即可。
 */
export function fc<A extends unknown[], R>(
  f: (ctx: StateHolderWithNode<Node, readonly Node[]>, ...args: A) => R,
) {
  return function (...vs: A) {
    return function (ctx: unknown) {
      f.apply(f, [ctx as StateHolderWithNode<Node, readonly Node[]>, ...vs])
    }
  }
}

/** forEach 区域组件的 config 形态（PREVIEW demo）：{ forEach, creater } 两个成员 */
export interface ForEachConfig<T> {
  forEach(callback: (key: unknown, value: T) => GetValue<unknown>): void
  creater(
    this: StateHolder<Node, readonly Node[]>,
    key: unknown,
    eachTime: EachTime<T>,
  ): unknown
}

/**
 * forEach 区域组件：支持两种调用形态——
 * 双函数：forEach apply <提供者> <渲染回调>（TODO demo）；
 * config 对象：forEach apply { forEach(block){…}, creater(ic, et, key){…} }（PREVIEW demo）。
 * creater 的包装：mve 传 (key, eachValue)；eachValue 就是本行 SubHolder（有 addNode / value / index），
 * 因此把 ic=et=eachValue、key 放第三参交给 OOC 回调（demo 里 ic addNode 收集到该行、et value 取项）。
 */
export const forEach = fc(function (
  ctx: StateHolderWithNode<Node, readonly Node[]>,
  configOrEach: ForEachConfig<unknown> | ((callback: (key: unknown, value: unknown) => unknown) => unknown),
  callbackCreater?: (key: unknown, eachValue: EachTime<unknown>) => unknown,
) {
  const each =
    typeof configOrEach === 'function'
      ? (configOrEach as (callback: (key: unknown, value: unknown) => unknown) => unknown)
      : (configOrEach.forEach as unknown as (callback: (key: unknown, value: unknown) => unknown) => unknown)
  const creater =
    typeof configOrEach === 'function'
      ? (callbackCreater as (...args: unknown[]) => unknown)
      : (configOrEach.creater as unknown as (...args: unknown[]) => unknown)
  ctx.renderForEach(each, function (key: unknown, eachValue: unknown) {
    return creater.call(eachValue, eachValue, eachValue, key)
  })
})