// OOC 编译产物的运行时辅助头部模板（内联进生成的 .ts 文件顶部）。
// 语义与解释器 1:1 对齐：runtime.ts（sendMessage/objectValue）+ num.ts + object.ts。
// 宿主无关（storage/js/dom 等 globals 由 run 入参注入），产物自包含可被 tsc 检查。

// 注意：本模板是字符串，内部不能出现未转义的反引号与模板插值 ${。

// 共享 runtime 模块源码：给定义加 export，作为项目构建（ooc build）的 _ooc_runtime.ts。
// 宿主无关：视图/信号/storage 等依赖由 OOC 侧 #import 进来，这里只提供消息派发与对象构造。
export const OOC_RUNTIME_MODULE = String.raw`// ---- OOC 运行时辅助（与解释器语义对齐，宿主无关）----
export const OOC_NUM_DEF: Record<string, (a: any, b: any) => any> = {
  '+': (a, b) => a + b,
  '-': (a, b) => a - b,
  '*': (a, b) => a * b,
  div: (a, b) => a / b,
  '%': (a, b) => a % b,
  '>': (a, b) => a > b,
  '<': (a, b) => a < b,
  '>=': (a, b) => a >= b,
  '<=': (a, b) => a <= b,
}
export const OOC_OBJ_DEF: Record<string, (sender: any, v?: any) => any> = {
  '==': (a: any, v: any) => a == v,
  '!=': (a: any, v: any) => a != v,
  '!!': (a: any) => Boolean(a),
  '~!': (a: any) => !Boolean(a),
  '&&': (a: any, v: any) => a && v,
  '||': (a: any, v: any) => a || v,
  not: (a: any) => !Boolean(a),
  include: (a: any, v: any) =>
    typeof a == 'function' ? v instanceof a
    : a && typeof a.includes == 'function' ? a.includes(v)
    : a && typeof a.has == 'function' ? a.has(v)
    : a === v,
}
export type OOCEntry = {
  type: 'bind' | 'mutable' | 'call'
  name: string
  /** bind/mutable 的惰性 thunk：首次访问时调用求值；call 的实现函数 */
  fn?: (...args: any[]) => any
  /** 惰性求值标记与缓存（首次访问时写入） */
  lazyDone?: boolean
  lazy?: any
}
// 展开参数辅助：'...expr' 求值为数组则摊平，否则整体作单参（与解释器语义一致）
export function __spread(value: any): any[] {
  return Array.isArray(value) ? value : [value]
}
// 反射元信息键：与解释器（object-oriented-c-language 的 OOC_META）同源——
// 全局符号注册表 Symbol.for 让编译产物与宿主桥接层（如 ObjectValue.metaOf）
// 读到同一份元信息，宿主据此区分事件回调（call）与常量绑定（bind）。
export const OOC_META: unique symbol = Symbol.for('ooc:meta')
export const OOC_EMPTY_OBJECT = {}
Object.defineProperty(OOC_EMPTY_OBJECT, OOC_META, { enumerable: false, value: new Map() })
export function __send(o: any, value: string, args: any[]): any {
  if (typeof o == 'function' && value == 'apply') return o.apply(o, args)
  const fun = o?.[value]
  if (typeof fun == 'function') return fun.apply(o, args)
  if (value in Object(o)) {
    if (args.length) o[value] = args[0]
    return o[value]
  }
  const num = OOC_NUM_DEF[value]
  if (num) return num(o, args[0])
  const obj = OOC_OBJ_DEF[value]
  if (obj) return obj(o, args[0])
  throw new Error('OOC 方法未找到: ' + String(o) + ' . ' + value + '(' + args.map((a) => String(a)).join(', ') + ')')
}
export function __createObject(entries: OOCEntry[]): any {
  if (entries.length === 0) return OOC_EMPTY_OBJECT
  const obj: Record<string, unknown> = {}
  const groups = new Map<string, OOCEntry[]>()
  for (const e of entries) {
    let list = groups.get(e.name)
    if (!list) groups.set(e.name, (list = []))
    list.push(e)
  }
  // 与解释器 objectValue 一致：把定义表当作反射元信息烧录（不可枚举），
  // 宿主/桥接层可经 ObjectValue.metaOf 判断类型（call=事件回调、bind=常量）
  Object.defineProperty(obj, OOC_META, { enumerable: false, value: groups })
  groups.forEach((methods, name) => {
    // 名字唯一（校验器保证）：每个 key 只有一个成员，直接派发，不再按参数数量匹配。
    const pair = methods[0]
    Object.defineProperty(obj, name, {
      enumerable: true,
      value() {
        const args = Array.from(arguments)
        switch (pair.type) {
          case 'bind':
            // 惰性绑定：读取即求值一次并缓存（参数忽略）
            if (!('lazyDone' in pair)) { pair.lazyDone = true; pair.lazy = pair.fn!.call(this) }
            return pair.lazy
          case 'mutable':
            // 转发属性同样惰性：首次发消息时求值委托对象并缓存
            if (!('lazyDone' in pair)) { pair.lazyDone = true; pair.lazy = pair.fn!.call(this) }
            return __send(pair.lazy, 'apply', Array.from(args))
          default:
            // call：#guard 分支已编译进 fn（if/else if 链），直接调用
            return pair.fn!.apply(this, args)
        }
      },
    })
  })
  return obj
}
`
