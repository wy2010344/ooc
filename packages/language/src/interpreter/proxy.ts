/**
 * 兜底代理（Proxy catch-all）：把 target 包成 JS Proxy。
 *
 * 语言不做任何 methodNotFound 兜底——未知消息在 sendMessage 直接抛
 * OocMethodNotFoundError。要拦截未知消息就显式包兜底 Proxy：get trap 拦下
 * target 不存在的消息名，统一交给 handler(name, ...args)。
 *
 * - 已存在的属性与 symbol 键（如 OOC_META 元信息）直通，不参与转发；
 * - handler 传入的实参是 (消息名, ...调用参数)；
 * - 未声明 methodNotFound 这个名字约定，handler 由宿主/调用方显式给出。
 */
export function proxyCatchAll<T extends object>(
  target: T,
  handler: (name: string, ...args: unknown[]) => unknown,
): T {
  return new Proxy(target, {
    get(t, prop, receiver) {
      if (typeof prop !== 'string' || prop in t) {
        return Reflect.get(t, prop, receiver)
      }
      return (...args: unknown[]) => handler.call(t, prop, ...args)
    },
  })
}