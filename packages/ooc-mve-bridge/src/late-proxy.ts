/**
 * 延迟绑定的影子对象。
 *
 * 与 wy-helper 的 `createLateProxy` 语义/实现一致。上游 wy-helper 的这个 API
 * 目前只存在于本地工作区、尚未发布到 CI clone 得到的远程版本，故桥接包自带一份，
 * 避免本仓库的构建依赖一个远程不存在的导出。待上游发布后可改回
 * `export { createLateProxy } from 'wy-helper'`。
 *
 * 典型用法：先创建影子 b 并传给其它对象，等真实对象 c 构造完成后再注入。
 * 注入前访问 b 会立即报错，避免把「还没准备好」悄悄当成空对象。
 */
export interface LateProxy<T extends object> {
  /** 可提前持有的影子对象，所有属性访问转发到已注入的真实对象 */
  readonly proxy: T
  /** 注入真实对象；只允许注入一次 */
  set(value: T): T
}

export function createLateProxy<T extends object>(): LateProxy<T> {
  let target: T | undefined

  function getTarget(): T {
    if (target === undefined) {
      throw new Error('lateProxy: target has not been injected')
    }
    return target
  }

  const proxy = new Proxy({} as T, {
    get(_t, key, receiver) {
      // receiver 保持为 proxy，getter 里的 this 始终是影子对象
      return Reflect.get(getTarget(), key, receiver)
    },
    set(_t, key, value) {
      // 直接写真实对象；OOC 的普通数据属性写入走这里
      return Reflect.set(getTarget(), key, value, getTarget())
    },
    has(_t, key) {
      return Reflect.has(getTarget(), key)
    },
    ownKeys() {
      return Reflect.ownKeys(getTarget())
    },
    getOwnPropertyDescriptor(_t, key) {
      const desc = Reflect.getOwnPropertyDescriptor(getTarget(), key)
      if (!desc) {
        return undefined
      }
      // 代理目标是空对象；向外部报告真实对象的不可配置描述符会违反 Proxy 不变量。
      // OOC 生成的成员全部可配置，因此这里统一放宽，读取语义不变。
      return { ...desc, configurable: true }
    },
    deleteProperty(_t, key) {
      return Reflect.deleteProperty(getTarget(), key)
    },
    getPrototypeOf() {
      return Reflect.getPrototypeOf(getTarget())
    },
  })

  return {
    proxy,
    set(value) {
      if (target !== undefined) {
        throw new Error('lateProxy: target has already been injected')
      }
      if (
        value === null ||
        (typeof value !== 'object' && typeof value !== 'function')
      ) {
        throw new TypeError('lateProxy: target must be an object')
      }
      target = value
      return value
    },
  }
}
