import { sendMessage } from './runtime.js'
import { isCatchAllProxy, proxyCatchAll } from './proxy.js'
import { OocMethodNotFoundError } from './errors.js'
import { numDef } from '../library/num.js'
import { objectDefine } from '../library/object.js'

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
 * union：消息联合的**构造器**（具象化对象）。
 *
 * 把「对象能消化的消息」看成一组联合
 *   `(nameA, arg1, arg2...) | (nameB, arg1, ...) | …`
 * 方法名就是判别标识。向 union 发任何消息，它都不处理，而是把这条消息
 * 原样折成一个联合成员值——普通数组元组 `[name, ...args]`：
 *
 *   union add 1 2      → ['add', 1, 2]
 *   union tag          → ['tag']
 *
 * 元组不带接收者，所以是可持有、可转发、可存进信号、可回放的一等值；
 * 消解（把元组交回某个对象的处理分支）由 `Object dispatch 对象 元组` 完成，
 * 见 runtime.ts。旧写法 `Object send 对象 '名字' 实参…` 保持不变。
 *
 * 实现上就是一个兜底 Proxy：handler 恒返回元组，永不弃权。因此把 union
 * 放进 merge 链时它会吞掉后面的层（这是「通用消息记录器」的正确行为），
 * 要兜底请把它放在链尾。
 *
 * 纯 OOC 里等价写法：`js proxy {} [name, ...args => Array of name ...args]`；
 * 内建一份是为了不依赖 js 桥接、让名字在类型侧可见，并对两条运行时给出同一值。
 */
export const union: Record<string, unknown> = proxyCatchAll(
  {},
  (name, ...args) => [name, ...args],
)

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
 * 命中即停，除非该层「没有该成员」或显式返回 UNHANDLED（见上）——两者在
 * 应答代数里都是 `unhandled`，链继续向后问；用户层之后还挂一层内建协议
 * （`numDef` / `objectDefine`）作为最后一个显式后继；全链耗尽才抛
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
    return createMessageChain(entries)
  },
}

/**
 * 一层对一条消息的应答代数：`handled(value)` | `unhandled`。
 *
 * 「这一层没有该成员」与「这一层显式返回 UNHANDLED」在这里收敛成**同一个结果**，
 * 链的循环只有一个判据。对象被当作消息处理中心：方法名是消息联合类型的判别
 * 标识，缺分支是一次合法应答，不是异常；异常只在整条链耗尽后由出口抛一次。
 */
type LayerAnswer =
  | { readonly handled: false }
  | { readonly handled: true; readonly value: unknown }

const UNHANDLED_ANSWER: LayerAnswer = { handled: false }

/**
 * 问一层「这条消息你接不接」，并按需要真正调用该层的实现。
 * 判据顺序与 sendMessage 一致：own descriptor → 原型链 / 宿主内建的 `in`
 * → 兜底 Proxy 的 get trap（它对任何名字都应答，没有 has trap，`in` 查不出来）。
 *
 * home-object 语义：成员在哪层命中，`this` 就是那层对象。
 */
function answerOf(o: unknown, name: string, args: unknown[]): LayerAnswer {
  if (o == null) return UNHANDLED_ANSWER
  const catchAll = isCatchAllProxy(o)
  const desc = Object.getOwnPropertyDescriptor(o, name)
  let value: unknown
  if (desc) {
    // getter 以命中层为 this 单次读取，结果原样返回（可为 lambda，绝不二次调用）。
    if (desc.get || desc.set) {
      value = desc.get ? desc.get.call(o) : undefined
    } else if (typeof desc.value === 'function') {
      value = desc.value.apply(o, args)
    } else {
      value = desc.value
    }
  } else if (catchAll || name in Object(o)) {
    const v = (o as Record<string, unknown>)[name]
    value = typeof v === 'function' ? v.apply(o, args) : v
  } else {
    return UNHANDLED_ANSWER
  }
  // 兜底 Proxy 的 handler 没写弃权时，undefined 按「这条我不接」处理：
  // 代理对任何名字都应答，若不缺省弃权，它会把后面的兜底对象全部吃掉。
  if (catchAll && value === undefined) return UNHANDLED_ANSWER
  // 只认唯一哨兵的严格相等；nil / false / 0 / undefined 都是正常应答。
  return value === UNHANDLED
    ? UNHANDLED_ANSWER
    : { handled: true, value }
}

/**
 * 内建协议作为链的**最后一个显式后继**：numDef / objectDefine 对一切对象都
 * 应答，从前是 sendMessage 尾部的隐式特例，导致 `merge` 包装反而收不到
 * `+` / `||`。挂进链后用户层仍优先（同名可覆盖），全链耗尽才轮到它。
 */
function builtinProtocolLayer(receiver: unknown): Record<string, unknown> {
  const layer: Record<string, unknown> = {}
  const put = (name: string, fn: (...args: unknown[]) => unknown) => {
    Object.defineProperty(layer, name, {
      enumerable: true,
      configurable: true,
      value: fn,
    })
  }
  for (const [name, fn] of Object.entries(numDef)) {
    put(name, (...args) =>
      (fn as (a: unknown, b: unknown) => unknown)(receiver, args[0]),
    )
  }
  for (const [name, fn] of Object.entries(objectDefine)) {
    put(name, (...args) => fn(receiver, ...args))
  }
  return layer
}

/**
 * 组装「链式委托包装对象」：把链挂到包装自己的 own __chain 键上，兜底 Proxy 包一层。
 *
 * 这是语言里唯一的消息路由链实现：`merge $` 与解释器的 `currentScope` 共用同一条链
 * （命中即停、任意层可弃权、链尾内建协议、全链耗尽抛同一个结构化错误）。对外导出
 * 是为了让「作用域」也能作为一个普通对象参与路由，而不是另写一套特例派发。
 */
export function createMessageChain(entries: unknown[]): unknown {
  const wrapper: Record<string, unknown> = {}
  Object.defineProperty(wrapper, '__chain', {
    value: entries,
    enumerable: true,
    writable: false,
    configurable: false,
  })
  const layers = [...entries]
  // home-object 语义：成员在哪层命中，this 就是那层对象（见 merge 头注释）。
  const wrapped = proxyCatchAll(wrapper, (name, ...args) => {
    for (const layer of layers) {
      const answer = answerOf(layer, name, args)
      if (answer.handled) return answer.value
    }
    // 全链（含内建协议）都没接：出口抛唯一的结构化错误。
    throw new OocMethodNotFoundError(wrapped, name, args)
  })
  layers.push(builtinProtocolLayer(wrapped))
  return wrapped
}
