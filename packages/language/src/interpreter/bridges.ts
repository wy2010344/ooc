import { invoke } from './runtime.js'

/**
 * 宿主注入的 JS 全局对象（storage/loop/js），供 OOC 源码直接按名引用。
 * 浏览器 demo（packages/example/src/main.ts）与语言包单元测试共用这一份，
 * 保证行为一致。
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

/** loop：OOC 没有控制流关键字，用宿主对象补上 */
export const loop = {
  // loop apply fn：只要 fn 返回真值就继续循环（至少调用一次）
  apply(fn: unknown) {
    while (invoke(fn)) {}
    return null
  },
  // loop repeat n fn：恰好执行 fn n 次
  repeat(n: unknown, fn: unknown) {
    const times = Number(n)
    if (!Number.isFinite(times) || times < 0 || Math.floor(times) !== times) {
      throw new TypeError(`loop repeat 需要非负整数次数，收到 ${n}`)
    }
    for (let i = 0; i < times; i++) {
      invoke(fn)
    }
    return null
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
  // js fn lambda → 把 OOC lambda 包装成真 JS 函数（给定时器/事件回调用）
  fn(lambda: unknown) {
    return (...args: unknown[]) => invoke(lambda, args)
  },
}
