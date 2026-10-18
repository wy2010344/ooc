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
// 「方法函数」标记键：与解释器（object-oriented-c-language 的 OOC_METHOD）同源——
// Symbol.for 全局注册表让编译产物与宿主桥接层（如 dom.ts）读到同一符号。
// 「=>」方法编译成的函数附带此标记，运行时/宿主据此区分「方法」与「lambda 值」。
export const OOC_METHOD: unique symbol = Symbol.for('ooc:method')
export type OOCEntry =
  /** 字面量绑定：构造期求值一次，直接写数据属性 */
  | { type: 'value'; name: string; value: any }
  /** 计算绑定：惰性求值一次并缓存（getter） */
  | { type: 'bind'; name: string; fn: () => any }
  /** 方法（「=>」/带参）：数据函数 + OOC_METHOD 标记，发消息即调用 */
  | { type: 'call'; name: string; fn: (...args: any[]) => any }
  /** 转发属性（「<=」）：数据函数 + 标记，发消息转发给委托对象的 $ */
  | { type: 'mutable'; name: string; fn: (...args: any[]) => any }
// 展开参数辅助：'...expr' 求值为数组则摊平，否则整体作单参（与解释器语义一致）
export function __spread(value: any): any[] {
  return Array.isArray(value) ? value : [value]
}
// 转发属性「<=」的构造器：惰性求值委托对象一次并缓存，之后本 key 上的一切消息
// 原样转发给委托对象的 $（消息名不传，只传实参）。
export function __mutable(getDelegate: () => any): any {
  let done = false
  let d: any
  return function (this: any) {
    if (!done) { done = true; d = getDelegate.call(this) }
    return __send(d, 'apply', Array.from(arguments))
  }
}
export function __send(o: any, value: string, args: any[]): any {
  if (typeof o == 'function' && value == 'apply') return o.apply(o, args)
  // 自有 descriptor 决定成员形态：getter＝计算绑定（取值，读一次缓存）；带 OOC_METHOD
  // 标记的数据函数＝方法（调用）；其余数据函数＝宿主方法（调用）；数据非函数＝字面量
  // 绑定（只读）/宿主属性（带参且可写才写入，否则读取）。无 own descriptor 走下方回退链。
  const desc = o == null || (typeof o !== 'object' && typeof o !== 'function')
    ? undefined
    : Object.getOwnPropertyDescriptor(o, value)
  if (desc) {
    if (desc.get || desc.set) {
      if (args.length && desc.set) { desc.set.call(o, args[0]); return o[value] }
      return desc.get ? desc.get.call(o) : undefined
    }
    if (typeof desc.value === 'function') {
      // 数据函数＝OOC 方法（带标记）或宿主方法 → 调用
      return desc.value.apply(o, args)
    }
    if (args.length && desc.writable) o[value] = args[0]
    return o[value]
  }
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
  if (entries.length === 0) return {}
  const obj: Record<string, unknown> = {}
  for (const e of entries) {
    // 同名成员派发取首个定义（唯一性由校验器保证）：已挂载的名字跳过后续定义，
    // 否则 defineProperty 会因不可重定义而抛错。
    if (Object.prototype.hasOwnProperty.call(obj, e.name)) continue
    if (e.type === 'value') {
      // 字面量绑定 → 只读数据属性（构造期写值一次，常量不因带参消息被改写）
      Object.defineProperty(obj, e.name, { enumerable: true, writable: false, value: e.value })
      continue
    }
    if (e.type === 'bind') {
      let done = false
      let cached: any
      Object.defineProperty(obj, e.name, {
        enumerable: true,
        get() {
          if (!done) { done = true; cached = e.fn!.call(this) }
          return cached
        },
      })
      continue
    }
    // call / mutable：数据函数 + OOC_METHOD 标记（供运行时/宿主区分方法与 lambda）
    const fn = e.fn!
    Object.defineProperty(fn, OOC_METHOD, { value: true })
    Object.defineProperty(obj, e.name, { enumerable: true, value: fn })
  }
  return obj
}
`
