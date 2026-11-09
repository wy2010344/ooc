import { sendMessage } from './runtime.js'
import { isCatchAllProxy, proxyCatchAll } from './proxy.js'
import { OocMethodNotFoundError } from './errors.js'

/**
 * 宿主注入的 JS 全局对象（storage/js/merge），供 OOC 源码直接按名引用。
 * 浏览器 demo（packages/example/src/main.ts）与语言包单元测试共用这一份，
 * 保证行为一致。
 *
 * 能用 OOC 语言实现的尽量下沉到 packages/base（目前仅 loop），不再桥接。
 * 合并/兜底（merge $ overrides defaults）需要宿主提供的链式委托原语，故由宿主端 merge 提供。
 */

/** storage：可变更的引用（cell），OOC 用它与可变状态交互 */
export const storage = {
  ref(initial: unknown) {
    let v = initial
    return {
      get() {
        return v
      },
      set(x: unknown) {
        v = x
        return v
      },
    }
  },
}

/** js：消息传递表达不了的 JS 能力桥接 */
export const js = {
  // js throw 消息 → 抛 JS Error
  throw(message: unknown) {
    throw new Error(String(message))
  },
  // js new 构造器 参数… → new 构造器(参数…)
  new(ctor: unknown, ...args: unknown[]) {
    if (typeof ctor !== 'function') {
      throw new TypeError(`js new 需要构造函数，收到 ${ctor}`)
    }
    return new (ctor as new (...a: unknown[]) => unknown)(...args)
  },
  // js send 对象 消息名 参数数组 → 动态派发
  // 消息名是运行期字符串（如兜底 handler 收到的 name），方法体里无法拼接
  // 消息名，只能走这个原语把「对象 + 名字 + 参数」交给运行时。
  // 参数约定：单个数组参数视为完整参数列表（配合 rest 参数转发），
  // 否则按顺序广播（js send o 'foo' 1 2 ≡ sendMessage(o, 'foo', [1, 2])）。
  send(receiver: unknown, name: unknown, ...args: unknown[]) {
    const params =
      args.length === 1 && Array.isArray(args[0]) ? args[0] : args
    return sendMessage(receiver, String(name), params)
  },
  // js proxy 对象 handler → 包成兜底 Proxy：对象自身不存在的消息名统一拦截，
  // 转发给 handler(name, ...args)。语言没有 methodNotFound 魔法——要兜底就
  // 显式传 handler（OOC 侧常写 [name, ...args => ...] 或 { $ { ... } }）。
  proxy(obj: unknown, handler: unknown) {
    const fn =
      typeof handler === 'function'
        ? (handler as (...a: unknown[]) => unknown)
        : (handler as Record<string, unknown> | null | undefined)?.['$']
    if (typeof fn !== 'function') {
      throw new TypeError(
        `js proxy 的 handler 需要是 lambda 或带 $ 方法的对象，收到 ${handler}`,
      )
    }
    return proxyCatchAll(
      obj as Record<PropertyKey, unknown>,
      (name, ...args) => fn.call(handler, name, ...args),
    )
  },
}

/**
 * merge 委托链的「显式弃权」哨兵：链上任意一层（普通对象的方法 / 数据成员 /
 * 兜底 Proxy 的 handler）返回它，就表示本层不处理这条消息，继续查下一层。
 *
 * - 只认严格相等：nil / undefined / false / 0 都是正常应答，照旧「命中即停」；
 * - 只认本层显式返回，不 catch 别人的异常、不推断、不回溯，所以方法抛出的
 *   真错误会原样冒出，不会被静默当成弃权；
 * - 普通方法弃权前已产生的副作用不回滚，弃权判断要写在方法体最前面
 *   （OOC 的 #guard 判别天然在语句之前）；
 * - async 方法返回 Promise.resolve(UNHANDLED) 时同步检查看不到，弃权不生效
 *   ——契约只在同步路径成立，不为此把整条链改成 async。
 *
 * OOC 侧写 `merge unhandled` 拿到它（merge 全局上的数据属性）。
 */
export const UNHANDLED: unique symbol = Symbol('ooc.merge.unhandled')

/**
 * merge：合并/兜底桥。`$` 把多个对象按优先级组装成
 * 「链式委托包装」：包装上未命中的消息按链顺序查找，找到就取用了。
 * 组装期先对已包装的委托（自带 __chain 自有键）展平其链段，再包一层兜底
 * Proxy（见 chainWrap）；原对象（overrides/defaults）只读不写，可被多个 merge
 * 安全共享，也可把已组合的委托再拼接进新链（二次 merge 不丢链）。
 *
 * 命中即停，除非该层显式返回 UNHANDLED（见上）；全链弃权最终抛
 * OocMethodNotFoundError。
 *
 * this 语义是 home-object：成员在哪一层命中，this 就是那一层对象——
 * `merge $ a b` 里 a 方法的 this 恒为 a、b 方法的恒为 b。string / 类实例
 * 等宿主对象进链时，其方法依赖的内部字段与原型方法才不会丢（若把 this
 * 换成包装对象，方法体内部读写全部对不上号）。
 */
export const merge = {
  // 弃权哨兵：数据属性，OOC 侧无参读取 `merge unhandled`
  unhandled: UNHANDLED,
  // merge $ overrides defaults … → 链式委托包装对象
  $(...parts: unknown[]) {
    // 组装期展平：参数是已包装委托（自有 __chain 键）时取其链段并查，否则视为叶子
    const entries: unknown[] = []
    for (const p of parts) {
      const chain = p && typeof p === 'object'
          ? (p as Record<string, unknown>)?.['__chain']
          : undefined
      if (Array.isArray(chain)) {
        entries.push(...chain)
      } else {
        entries.push(p)
      }
    }
    return chainWrap(entries)
  },
}

/** 一层对 name 的应答：found=false 表示本层没有这个成员 */
type LayerHit =
  | { found: false }
  | { found: true; value: unknown; isMethod: boolean }

const NO_LAYER: LayerHit = { found: false }

/**
 * 查一层对 name 的应答，判据与 sendMessage 的派发顺序一致：
 * own descriptor → 原型链 / 宿主内建的 `in` → 兜底 Proxy 的 get trap。
 *
 * 兜底 Proxy 对任何名字都应答（没有 has trap，`in` 查不出来），故单独放行：
 * 它的 handler 会被调用，返回 UNHANDLED 才算弃权。这同时修好了「catch-all
 * Proxy 进链后被跳过、handler 永不触发」的老问题。
 */
function lookupLayer(o: unknown, name: string): LayerHit {
  if (o == null) return NO_LAYER
  const desc = Object.getOwnPropertyDescriptor(o, name)
  if (desc) {
    // getter 以命中层为 this 单次读取，结果原样返回（可为 lambda，绝不二次调用）。
    if (desc.get || desc.set) {
      return {
        found: true,
        value: desc.get ? desc.get.call(o) : undefined,
        isMethod: false,
      }
    }
    return {
      found: true,
      value: desc.value,
      isMethod: typeof desc.value === 'function',
    }
  }
  if (!isCatchAllProxy(o) && !(name in Object(o))) return NO_LAYER
  const value = (o as Record<string, unknown>)[name]
  return { found: true, value, isMethod: typeof value === 'function' }
}

/** 组装「链式委托包装对象」：把链挂到包装自己的 own __chain 键上，兜底 Proxy 包一层 */
function chainWrap(entries: unknown[]): unknown {
  const wrapper: Record<string, unknown> = {}
  Object.defineProperty(wrapper, '__chain', {
    value: entries,
    enumerable: true,
    writable: false,
    configurable: false,
  })
  // home-object 语义：成员在哪层命中，this 就是那层对象（见 merge 头注释）。
  const wrapped = proxyCatchAll(wrapper, (name, ...args) => {
    for (const o of entries) {
      const hit = lookupLayer(o, name)
      if (!hit.found) continue
      const value = hit.isMethod
        ? (hit.value as (...a: unknown[]) => unknown).apply(o, args)
        : hit.value
      // 任意层显式弃权 → 继续委托下一层；其余（含 nil/undefined）命中即停。
      if (value === UNHANDLED) continue
      return value
    }
    throw new OocMethodNotFoundError(wrapped, name, args)
  })
  return wrapped
}
