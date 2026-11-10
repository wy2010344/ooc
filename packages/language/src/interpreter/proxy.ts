/**
 * 兜底代理（Proxy catch-all）：把 target 包成 JS Proxy。
 *
 * 语言不做任何 methodNotFound 兜底——未知消息在 sendMessage 直接抛
 * OocMethodNotFoundError。要拦截未知消息就显式包兜底 Proxy：get trap 拦下
 * target 不存在的消息名，统一交给 handler(name, ...args)。
 *
 * - 已存在的属性、symbol 键、以及 JS 运行时协议探针（then / toJSON / includes…）
 *   直通，不参与转发；
 * - handler 传入的实参是 (消息名, ...调用参数)；
 * - 未声明 methodNotFound 这个名字约定，handler 由宿主/调用方显式给出；
 * - 在 merge 链里，handler 返回 `undefined` 缺省按「弃权」处理，继续查后继层
 *   （见 bridges.ts 的 answerOf）。
 */

/**
 * JS 运行时协议探针名：这些不是 OOC 消息，而是宿主/标准库在探测对象
 * （Promise 看 `then`、JSON.stringify 看 `toJSON`、容器判定看 `includes`/`has`）。
 * 兜底 Proxy 若给它们凭空造出函数，Promise 会把包装对象误认成 thenable、
 * JSON.stringify 会调用伪造的 toJSON、内建 `include` 会误判「有 includes」，
 * 都会绕进消息链再抛方法未定义。一律直通 target，回到 JS 原生语义。
 * （`toString` / `valueOf` / `constructor` 在 Object.prototype 上，`prop in t`
 * 已天然直通；symbol 键本来就不过 get trap。）
 */
const JS_PROBE_NAMES = new Set(['then', 'toJSON', 'includes', 'has', 'inspect'])

/** 兜底代理登记表：这些对象对**任何**消息名都会应答（`has` 陷阱缺省时无法从外部判断） */
const catchAllProxies = new WeakSet<object>()

/** 是否为兜底代理（respondsTo 用；业务代码不需要知道） */
export function isCatchAllProxy(o: unknown): boolean {
  return (
    (typeof o === 'object' && o !== null) || typeof o === 'function'
  ) && catchAllProxies.has(o as object)
}

/** 包装成兜底代理：未知消息名统一交给 handler(name, ...args) */
export function proxyCatchAll<T extends object>(
  target: T,
  handler: (name: string, ...args: unknown[]) => unknown,
): T {
  const proxy = new Proxy(target, {
    get(t, prop, receiver) {
      if (
        typeof prop !== 'string' ||
        prop in t ||
        JS_PROBE_NAMES.has(prop)
      ) {
        return Reflect.get(t, prop, receiver)
      }
      return (...args: unknown[]) => handler.call(t, prop, ...args)
    },
  })
  catchAllProxies.add(proxy)
  return proxy
}