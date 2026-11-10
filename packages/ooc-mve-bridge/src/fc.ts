import type { StateHolder, StateHolderWithNode } from 'mve-core'
import type { GetValue } from 'wy-helper'

/**
 * 行对象的结构约定。mve-core 的 EachTime 在本地旧构建里是 `EachTime<T>`、
 * 在最新源码里是 `EachTime<T, K>`，TS 按泛型参数个数直接报错。这里按结构
 * 声明（TS 是结构类型系统），本包就不必绑死在某一份 .d.ts 上：本地旧 dist
 * 与 CI 用最新源码重新 build 出的 dist 都能编译。
 */
export interface EachTimeLike<T> {
  getIndex(): number
  getValue(): T
  key: unknown
}

/**
 * 组件包装：f 的第一个形参是 ctx（StateHolder，构建期可用 addNode/addDestroy），
 * 其余是用户实参。fc $ <arg>... 生成惰性组件（(ctx) => …），挂载期再执行 f。
 * 与 preview/dom.ts 的 DComponent 一致：调用方传 (ctx: unknown) 即可。
 */
export function fc<N = Node, A extends unknown[] = unknown[], R = unknown>(
  f: (ctx: StateHolderWithNode<N, readonly N[]>, ...args: A) => R,
) {
  return function (...vs: A) {
    return function (ctx: unknown) {
      f.apply(f, [ctx as StateHolderWithNode<N, readonly N[]>, ...vs])
    }
  }
}

/** forEach 区域组件的 config 形态（PREVIEW demo）：{ forEach, creater } 两个成员 */
export interface ForEachConfig<T> {
  forEach(callback: (key: unknown, value: T) => GetValue<unknown>): void
  creater(
    this: StateHolder<Node, readonly Node[]>,
    key: unknown,
    eachTime: EachTimeLike<T>,
  ): unknown
}

/**
 * forEach 区域组件：支持两种调用形态——
 * 双函数：forEach $ <提供者> <渲染回调>（TODO demo）；
 * config 对象：forEach $ { forEach(block){…}, creater(ic, et, key){…} }（PREVIEW demo）。
 * creater 的包装：mve 传 (key, eachValue)；eachValue 就是本行 SubHolder（有 addNode / value / index），
 * 因此把 ic=et=eachValue、key 放第三参交给 OOC 回调。OOC 里用 `canvas2 rect {...} $ ic`
 * 让节点工厂自己挂到该行；`ic addNode` 只会把 Fc 塞进数组，节点不会构建。
 */
export const forEach = fc(function (
  ctx: StateHolderWithNode<Node, readonly Node[]>,
  configOrEach: ForEachConfig<unknown> | ((callback: (key: unknown, value: unknown) => unknown) => unknown),
  callbackCreater?: (key: unknown, eachValue: EachTimeLike<unknown>) => unknown,
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
