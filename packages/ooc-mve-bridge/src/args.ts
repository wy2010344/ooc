/**
 * 桥接共享工具：把 OOC 侧的「属性对象 / 子组件列表」翻译成宿主可直接吃的形态。
 *
 * 属性对象不是普通对象：OOC 的 `merge` 会包成带 `__chain` 的委托包装，
 * 且成员分三类（`=` 数据属性、`=` 计算式 getter、`=>`/`{…}` 方法）。
 *
 * 有两条路径，新桥接一律用第二条：
 * - `collectProps`：**枚举**成员做快照（仅 canvas v1 / three 这类宿主工厂自己按属性读的旧路径）；
 * - `collectMessages`：按**契约名逐个发消息**（canvasRender2 用）。OOC 对象可能是
 *   merge 委托或 Proxy，键枚举不出来；getter/method 的 `this` 也必须落在定义它的那一层。
 */
import { hookTrackAttr } from 'mve-core'
import { respondsTo, sendMessage, UNHANDLED } from 'object-oriented-c-language'

/** 读值：lambda（GetValue）就调用，普通值原样返回——文本/数字读数统一入口 */
export function readValue(value: unknown): unknown {
  return typeof value === 'function' ? (value as () => unknown)() : value
}

/**
 * 读取属性对象：支持 merge 链（自身带 `__chain` 的委托包装）。
 * 这是属性收集快照：链段从前往后扫，第一个非 `undefined`、非弃权哨兵的值生效。
 * （消息派发另见 `sendTo`：那边是命中即停，方法返回 `undefined` 也不后查，
 * 只有显式返回 UNHANDLED 才继续委托。）
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
      // 弃权哨兵不是属性值：跳过，让后面链段 / 宿主默认值生效
      if (value === undefined || value === UNHANDLED) {
        continue
      }
      seen.add(key)
      result[key] = value
    }
  }
  return result
}

/** 构建设置：不是节点消息，宿主工厂要的是原始值（不是转发器） */
const CONFIG_KEYS = ['children', 'exts', 'layout', 'nodeRef', 'scroll'] as const

/** merge 委托链：`__chain` 是宿主 merge 的装配信息（与语言内建 merge 同一份约定） */
function chainOf(target: unknown): readonly unknown[] | null {
  if (!target || typeof target !== 'object') {
    return null
  }
  const chain = (target as Record<string, unknown>)['__chain']
  return Array.isArray(chain) ? chain : null
}

/**
 * 目标是否应答 `name` 消息：merge 链上任意一层应答即可。
 * 静态的名字查询，不预知该层运行时是否显式弃权（见 sendTo）。
 */
export function hasMessage(target: unknown, name: string): boolean {
  const chain = chainOf(target)
  if (chain) {
    return chain.some((layer) => layer != null && respondsTo(layer, name))
  }
  return respondsTo(target, name)
}

/**
 * 向对象发一条消息。
 *
 * - merge 链逐层询问，**命中即停**：该层应答就用它，值为 nil 也不再向后查
 *   （与 merge 的 home-object 语义一致，this 落在定义成员的那一层）；
 * - 例外：该层显式返回 `UNHANDLED`（OOC 侧 `merge unhandled`）就继续查下一层；
 * - 对象不应答 / 全链弃权时返回 undefined（调用方据此判断「没写」，让宿主默认值生效）。
 *
 * hasMessage 是静态名字查询，不预知运行时弃权；弃权只在真正发消息时判定。
 */
export function sendTo(target: unknown, name: string, args: unknown[]): unknown {
  const chain = chainOf(target)
  if (chain) {
    for (const layer of chain) {
      if (layer == null || !respondsTo(layer, name)) continue
      const value = sendMessage(layer, name, args)
      if (value === UNHANDLED) continue
      return value
    }
    return undefined
  }
  if (!respondsTo(target, name)) return undefined
  const value = sendMessage(target, name, args)
  return value === UNHANDLED ? undefined : value
}

/** 无参消息读取：属性值 / 计算式 getter 都按消息取一次原始值 */
export function readMessage(target: unknown, name: string): unknown {
  return sendTo(target, name, [])
}

/**
 * 消息成员转发器：宿主契约里的「GetValue」与「回调」都是函数，这里把调用转发成消息。
 *
 * 为什么不用快照函数：OOC 的 getter 返回 lambda（`background = [color]`），
 * 而方法（`draw(ctx2) { … }`）要带实参执行；两种形态在调用时才分得清。
 * 转发器统一处理：
 * - getter → 消息返回 lambda → 用同样的实参调用它；
 * - 方法 → 消息直接执行（`this` 是定义的层）→ 返回结果；
 * - 数据值（`radius = 8`）→ 原样返回。
 */
export function bindMessage(
  target: unknown,
  name: string,
): (...args: unknown[]) => unknown {
  return (...args: unknown[]) => {
    const value = sendTo(target, name, args)
    return typeof value === 'function'
      ? (value as (...a: unknown[]) => unknown)(...args)
      : value
  }
}

/**
 * 按**消息契约**把 OOC 属性对象翻译成宿主工厂的参数对象（canvasRender2 用）。
 *
 * 契约名来自 `defaults`（**宿主自己的**兜底对象，枚举它是安全的）；属性对象的成员
 * 一律按名字发消息，绝不枚举——OOC 对象可能是 merge 委托 / Proxy，也要求 `this` 正确。
 *
 * - `defaults` 取值为函数的名字是消息成员 → 给转发器（对象不应答就不给，让宿主兜底）；
 * - 取值为普通值的名字是值成员（如 `maxHistorySize`）→ 发无参消息读一次；
 * - `CONFIG_KEYS` 与 `values` 是构建设置 → 读原始值（`exts` / `layout` / `scroll`…）。
 */
export function collectMessages(
  props: unknown,
  defaults: readonly object[],
  values: readonly string[] = [],
): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  const seen = new Set<string>()
  for (const def of defaults) {
    for (const [name, fallback] of Object.entries(def)) {
      if (seen.has(name) || (CONFIG_KEYS as readonly string[]).includes(name)) {
        continue
      }
      seen.add(name)
      if (typeof fallback === 'function') {
        if (hasMessage(props, name)) {
          result[name] = bindMessage(props, name)
        }
      } else {
        const value = readMessage(props, name)
        if (value !== undefined) {
          result[name] = value
        }
      }
    }
  }
  for (const name of [...CONFIG_KEYS, ...values]) {
    const value = readMessage(props, name)
    if (value !== undefined) {
      result[name] = value
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
