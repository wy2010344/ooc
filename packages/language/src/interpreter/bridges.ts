import { readOocMeta, sendMessage, type OocMeta } from './runtime.js'

/**
 * 宿主注入的 JS 全局对象（storage/js/ObjectValue），供 OOC 源码直接按名引用。
 * 浏览器 demo（packages/example/src/main.ts）与语言包单元测试共用这一份，
 * 保证行为一致。
 *
 * 能用 OOC 语言实现的尽量下沉到 packages/base（delegate/loop），不再桥接。
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
  // 消息名是运行期字符串（如 methodNotFound 收到的 name），方法体里无法拼接
  // 消息名，只能走这个原语把「对象 + 名字 + 参数」交给运行时。
  // 参数约定：单个数组参数视为完整参数列表（配合 rest 参数转发），
  // 否则按顺序广播（js send o 'foo' 1 2 ≡ sendMessage(o, 'foo', [1, 2])）。
  send(receiver: unknown, name: unknown, ...args: unknown[]) {
    const params =
      args.length === 1 && Array.isArray(args[0]) ? args[0] : args
    return sendMessage(receiver, String(name), params)
  },
}

/**
 * ObjectValue：语言定义值的反射桥接。不改语言语义（仍鸭子类型、继承走原型链），
 * 只提供「判断是不是 OOC 定义对象、读取其元信息」的能力。
 * 元信息是对象构造时由 runtime 烧录的（OOC_META Symbol 键），语言内消息不可见，
 * 业务值无法伪造。lambda 仍是 JS 函数，不带这种元信息（isDefined 返回 false）。
 */
export const ObjectValue = {
  /** x 的元信息：{ members: 本层定义的消息表 }，非语言对象为 nil */
  metaOf(x: unknown): OocMeta | undefined {
    return readOocMeta(x)
  },
}
