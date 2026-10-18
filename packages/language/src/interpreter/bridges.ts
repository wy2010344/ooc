import { sendMessage } from './runtime.js'
import { proxyCatchAll } from './proxy.js'
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
        : (handler as Record<string, unknown> | null | undefined)?.['apply']
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
 * merge：合并/兜底桥。`$` 把多个对象按优先级组装成
 * 「链式委托包装」：包装上未命中的消息按链顺序查找，找到就取用了。
 * 组装期先对已包装的委托（自带 __chain 自有键）展平其链段，再包一层兜底
 * Proxy（见 chainWrap）；原对象（overrides/defaults）只读不写，可被多个 merge
 * 安全共享，也可把已组合的委托再拼接进新链（二次 merge 不丢链）。
 */
export const merge = {
  // merge $ overrides defaults … → 链式委托包装对象
  apply(...parts: unknown[]) {
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

/** 组装「链式委托包装对象」：把链挂到包装自己的 own __chain 键上，兜底 Proxy 包一层 */
function chainWrap(entries: unknown[]): unknown {
  const wrapper: Record<string, unknown> = {}
  Object.defineProperty(wrapper, '__chain', {
    value: entries,
    enumerable: true,
    writable: false,
    configurable: false,
  })
  // receiver 延迟绑定（Proxy 创建前先占位），让方法以包装对象本身执行
  const receiverHolder: { v: unknown } = { v: undefined }
  const wrapped = proxyCatchAll(wrapper, (name, ...args) => {
    for (const o of entries) {
      if (o == null) continue
      // descriptor 优先：属性成员（getter）以包装对象为 receiver 单次读取，
      // 结果原样返回（可为 lambda，绝不二次调用）；未命中（undefined）继续向后查找
      const desc =
        typeof o === 'object' || typeof o === 'function'
          ? Object.getOwnPropertyDescriptor(o, name)
          : undefined
      if (desc && (desc.get || desc.set)) {
        if (desc.get) {
          const v = desc.get.call(receiverHolder.v ?? o)
          if (v !== undefined) return v
        }
        continue
      }
      const v = (o as Record<string, unknown>)[name]
      if (v === undefined) continue
      if (typeof v === 'function') {
        // 真方法返回 undefined 视为无返回值，继续向后查找（委托查找的固有取舍）
        const r = v.apply(receiverHolder.v, args)
        if (r !== undefined) return r
        continue
      }
      return v
    }
    throw new OocMethodNotFoundError(receiverHolder.v, name, args)
  })
  receiverHolder.v = wrapped
  return wrapped
}
