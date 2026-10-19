/**
 * 桥接共享工具：把 OOC 侧的「属性对象 / 子组件列表」翻译成宿主可直接吃的形态。
 *
 * 属性对象不是普通对象：OOC 的 `merge` 会包成带 `__chain` 的委托包装，
 * 且成员分三类（`=` 数据属性、`=` 计算式 getter、`=>`/`{…}` 方法）。
 * 所以这里一律走 descriptor：
 * - getter（计算式）在这里求值一次；
 * - 方法保留**原始函数**、不做 bind——canvas/three 的调用方需要以自己的 `this` 调它。
 */
import { hookTrackAttr } from 'mve-core'

/** 读值：lambda（GetValue）就调用，普通值原样返回——文本/数字读数统一入口 */
export function readValue(value: unknown): unknown {
  return typeof value === 'function' ? (value as () => unknown)() : value
}

/**
 * 读取属性对象：支持 merge 链（自身带 `__chain` 的委托包装）。
 * 链段按 merge 语义从前往后查，先定义者生效；`undefined` 视为未定义继续后查。
 */
export function collectProps(arg: unknown): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  if (!arg || typeof arg !== 'object') {
    return result
  }
  const chain = (arg as Record<string, unknown>)['__chain']
  const sources: unknown[] = Array.isArray(chain) ? chain : [arg]
  const seen = new Set<string>()
  for (const source of sources) {
    if (!source || (typeof source !== 'object' && typeof source !== 'function')) {
      continue
    }
    for (const key of Object.keys(source)) {
      // __chain 是 merge 的装配信息，不外传
      if (key === '__chain' || seen.has(key)) {
        continue
      }
      const desc = Object.getOwnPropertyDescriptor(source, key)
      if (!desc) {
        continue
      }
      const value = desc.get ? desc.get.call(source) : desc.value
      if (value === undefined) {
        continue
      }
      seen.add(key)
      result[key] = value
    }
  }
  return result
}

/** 子组件展开：数组递归摊平，非函数忽略，函数以给定 ctx 调用 */
export function renderChildrenList(
  children: readonly unknown[],
  ctx: unknown,
): void {
  for (const child of children) {
    if (Array.isArray(child)) {
      renderChildrenList(child, ctx)
    } else if (typeof child === 'function') {
      ;(child as (ctx: unknown) => unknown)(ctx)
    }
  }
}

/**
 * 单值属性跟踪：值是 lambda 就响应式跟随（lambda 里读到的信号变化 → 重新 set），
 * 普通值只设置一次。
 */
export function trackProp(
  props: Record<string, unknown>,
  key: string,
  set: (value: any) => void,
): void {
  const value = props[key]
  if (value === undefined) {
    return
  }
  if (typeof value === 'function') {
    hookTrackAttr(value as () => unknown, set)
  } else {
    set(value)
  }
}
