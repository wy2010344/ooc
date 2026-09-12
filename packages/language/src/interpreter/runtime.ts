import { groupToMap } from 'wy-helper'
import {
  Expression,
  Method,
  MethodCallName,
  MethodDefName,
  Message,
  Statement,
} from '../generated/ast.js'
import { numDef } from '../library/num.js'
import { objectDefine } from '../library/object.js'
// 注意：与 evaluate.ts 互为依赖（运行时求值），都是函数/类级别引用、
// 模块初始化时不互相调用，ESM 循环依赖安全。
import {
  getStrValue,
  interpretExpression,
  interpretPrimary,
} from './evaluate.js'
import { addScope, type Scope } from './scope.js'
import { OocMethodNotFoundError } from './errors.js'

/** 空对象单例：`{}` 字面量共享同一个实例 */
const EMPTY_OBJECT: Record<string, unknown> = {}

/**
 * 语言定义值的「元信息」承载符。宿主/桥接层（如 ObjectValue）用它判断值是否
 * OOC 定义对象并读取反射信息。Symbol 键不进 Object.keys/for...in，消息查找按
 * 字符串消息名也不会命中它——元信息对语言内发消息不可见，只能经桥接显式读取。
 */
export const OOC_META = Symbol('ooc:meta')

/** 单条成员元信息：本层字面量定义了什么消息、属哪一类 */
export interface OocMemberMeta {
  name: string
  type: 'bind' | 'mutable' | 'call'
}

/** 对象元信息：只含本层定义，原型链父层的元信息沿链读取 */
export interface OocMeta {
  members: OocMemberMeta[]
}

/** 读值上的元信息；非 OOC 定义值（lambda/宿主值/原始值）返回 undefined */
export function readOocMeta(v: unknown): OocMeta | undefined {
  if (!v || (typeof v !== 'object' && typeof v !== 'function')) {
    return undefined
  }
  return (v as Record<symbol, unknown>)[OOC_META] as OocMeta | undefined
}

/** 创建元信息：非枚举挂到对象上，构造时烧录、事后不可伪造 */
function attachMeta(target: object, members: OocMemberMeta[]): void {
  Object.defineProperty(target, OOC_META, {
    enumerable: false,
    value: { members },
  })
}

/**
 * 折叠同名成员元信息：guard 重载（同名多条方法定义）与同名 bind 混排都会让
 * 同一 key 出现多次，烧录时折叠为一条。bind 是一次性缓存（静态），同名若还
 * 存在动态定义（call/mutable）则整个 key 升为动态；顺序取首现，便于遍历。
 */
function foldMemberMeta(
  pairs: Array<{ name: string; type: OocMemberMeta['type'] }>,
): OocMemberMeta[] {
  const folded = new Map<string, OocMemberMeta>()
  for (const { name, type } of pairs) {
    const exist = folded.get(name)
    if (!exist) {
      folded.set(name, { name, type })
      continue
    }
    if (exist.type === 'bind' && type !== 'bind') {
      exist.type = type
    }
  }
  return [...folded.values()]
}

// 空对象也烧录元信息：`{}` 同样是语言定义值（members 为空）
attachMeta(EMPTY_OBJECT, [])

/** OOC 创建对象的注册表。用 WeakSet 而非对象属性：属性名会穿过宿主
 *  Proxy 的 get 陷阱（如 dom 代理直接抛「不支持的元素」），WeakSet 无泄漏。 */
const oocObjects = new WeakSet<object>()

// 定义值类型
export type Value = number | string | boolean | null | OocObject

function getObjDefineName(n: MethodDefName) {
  const v = n.name
  switch (v.$type) {
    case 'Ref':
      return v.value
    case 'StID':
      return v.value.slice(1)
    case 'Str':
      return getStrValue(v)
  }
}
export type OocObject = object
function getName(n: { name: string }) {
  return n.name
}

/** 执行一个方法体：把参数（含 rest）绑进作用域后逐条求值表达式，返回最后一条的值。
 *  OOC 对象方法与原生 JS 函数型 lambda（见 evaluate.ts createLambdaValue）共用，
 *  receiver 绑定到 `responser`。guard 需引用参数时，先 bindMethod 再在返回的作用域上求值。 */
export function bindMethod(
  method: { params: Array<{ name: string }>; restParam?: { name: string } | null },
  baseScope: Scope,
  receiver: unknown,
  args: unknown[],
): Scope {
  let s = addScope(baseScope, 'responser', receiver)
  method.params.forEach((param, index) => {
    s = addScope(s, param.name, args[index])
  })
  if (method.restParam) {
    s = addScope(
      s,
      method.restParam.name,
      Array.prototype.slice.call(args, method.params.length),
    )
  }
  return s
}

/** 在已绑定参数的作用域上逐条执行方法体表达式，返回最后一条的值。 */
export function runBody(
  expressions: Array<Expression | Statement>,
  s: Scope,
): unknown {
  let last = null
  expressions.forEach((e) => {
    switch (e.$type) {
      case 'Assignment':
        s = addScope(s, e.name, interpretExpression(e.expression, s))
        return
      default:
        last = interpretExpression(e, s)
        return
    }
  })
  return last
}
export function objectValue(
  methods: Method[],
  scope: Scope,
  parent: OocObject | undefined,
) {
  // 空对象 {} 快速返回共享单例（无 parent 且无方法时）
  if (methods.length === 0 && !parent) {
    return EMPTY_OBJECT
  }
  // 顶层对象（无 parent）直接新建普通对象 {}，而非 Object.create(null)，
  // 保留 Object.prototype，JS 侧 toString/拼接等原生能力可用。
  const currentObject = parent ? Object.create(parent) : {}
  oocObjects.add(currentObject)
  scope = addScope(scope, 'currentObject', currentObject)
  const defs = methods.map((method) => {
    switch (method.$type) {
      case 'MethodBind':
        return {
          type: 'bind' as const,
          name: getObjDefineName(method.name),
          value: interpretExpression(method.expression, scope),
        }
      case 'MethodBindMutable':
        return {
          type: 'mutable' as const,
          name: getObjDefineName(method.name),
          value: interpretExpression(method.expression, scope) as unknown,
        }
      default:
        return {
          type: 'call' as const,
          name: getObjDefineName(method.name),
          value: method,
        }
    }
  })
  // 构造时烧录元信息：反射桥接（ObjectValue）由此识别语言定义值、读成员表；
  // 同名（guard 重载等）折叠为一条 key，避免遍历时重复
  attachMeta(
    currentObject,
    foldMemberMeta(defs.map(({ type, name }) => ({ type, name }))),
  )
  groupToMap(
    defs,
    getName,
  ).forEach(function (methods, name) {
    // 所有定义（含 bind）统一作为方法函数，bind 在函数体内直接返回绑定值
    Object.defineProperty(currentObject, name, {
      enumerable: true,
      value() {
        const args = arguments
        for (let i = 0; i < methods.length; i++) {
          const pair = methods[i]
          switch (pair.type) {
            case 'bind':
              return pair.value
            case 'mutable':
              if (args.length > 0) {
                ;(pair as { value: unknown }).value = args[0]
              }
              return pair.value
            case 'call':
              const method = pair.value
              // 先绑参数再求值 guard：guard 可引用参数（`#guard a > 5`）
              const s = bindMethod(method, scope, this, arguments as unknown as unknown[])
              if (
                !method.guardExpression ||
                (method.guardExpression &&
                  interpretExpression(method.guardExpression, s))
              ) {
                return runBody(method.expressions, s)
              }
          }
        }
        // 本层同名方法 guard 全不通过：沿原型链向上查找。必须用闭包捕获的
        // "本层对象"currentObject 定位父层，this 始终是最外层接收者，用它
        // 定位会递归回自身方法导致栈溢出；顶层对象（parent 为 null）无原型，
        // 跳过继续走通用方法与 methodNotFound。
        const proto = Object.getPrototypeOf(currentObject)
        if (proto) {
          const superFun = proto[name]
          if (typeof superFun === 'function') {
            return superFun.apply(this, args)
          }
        }

        //通用对象方法
        const fun = objectDefine[name as '&&']
        if (fun) {
          return fun(this, args[0])
        }
        if (name == 'methodNotFound') {
          const [methodName, ...methodArgs] = Array.from(args)
          if (typeof methodName === 'string') {
            throw new OocMethodNotFoundError(this, methodName, methodArgs)
          }
          throw new OocMethodNotFoundError(this, name, Array.from(args))
        }
        return sendMessage(this, 'methodNotFound', [name, ...args])
      },
    })
  })
  return currentObject
}

export function getMethodCallName({ value }: MethodCallName) {
  switch (value.$type) {
    case 'StID':
      return value.value.slice(1)
    case 'Str':
      return getStrValue(value)
    default:
      return value.value
  }
}

export function sendMessageWith(o: any, message: Message, scope: Scope) {
  const name = message.name
  const args = message.args.map((arg) => interpretPrimary(arg, scope))
  return sendMessage(o, getMethodCallName(name), args)
}

/**
 * 宿主原生方法收到 OOC lambda 时，把它包成真正的 JS 函数：
 * Array.forEach/map 等原生高阶方法要求回调可调用，而 OOC lambda 是
 * 带 apply 方法的 ObjectValue，直接传会报 "object is not a function"。
 * 包出来的是普通 JS 函数（typeof === 'function'），但保留 $$oocCall 引用，
 * 宿主若走 invoke() 也能正确回灌到解释器。
 */
function toNativeCallback(
  arg: unknown,
): unknown {
  if (
    arg &&
    typeof arg === 'object' &&
    oocObjects.has(arg) &&
    typeof (arg as { apply?: unknown }).apply === 'function'
  ) {
    const fn = (...rest: unknown[]) => sendMessage(arg, 'apply', rest)
    ;(fn as { $$oocCall?: object }).$$oocCall = arg
    return fn
  }
  return arg
}

export function sendMessage(o: any, value: string, args: any[]): any {
  // if (o instanceof ObjectValue) {
  //   return o.send(value, o, args)
  // }
  // 原生 JS 函数（lambda 型）之上的 apply：`fn apply x` 直接调用函数本体，
  // 否则会命中 Function.prototype.apply（对非数组 args 抛 TypeError）。
  if (typeof o === 'function' && value === 'apply') {
    return o(...args)
  }
  const fun = o == null ? undefined : o[value]
  if (typeof fun === 'function') {
    //找到对象方法。OOC 创建的对象（oocObjects）内部走原样派发；
    //宿主原生对象则把 OOC lambda 实参包成 JS 可调用回调。
    if (o && typeof o === 'object' && oocObjects.has(o)) {
      return fun.apply(o, args)
    }
    return fun.apply(o, args.map(toNativeCallback))
  }
  if (value === 'methodNotFound') {
    // 此处是未知消息的最终兜底：上一次派发已将原消息名放在第一个实参。
    // 保留它可让宿主准确判断究竟是哪条 OOC 消息未被处理。
    const [methodName, ...methodArgs] = args
    if (typeof methodName === 'string') {
      throw new OocMethodNotFoundError(o, methodName, methodArgs)
    }
    throw new OocMethodNotFoundError(o, value, args)
  }
  if (value in Object(o)) {
    //属性读取与设置
    if (args.length) {
      o[value] = args[0]
    }
    return o[value]
  }
  const num = numDef[value as '<']
  if (num) {
    return num(o, args[0])
  }
  const obj = objectDefine[value as '||']
  if (obj) {
    return obj(o, args[0])
  }
  return sendMessage(o, 'methodNotFound', [value, ...args])
}

/**
 * 宿主侧调用 OOC lambda 的公开入口，等价于 OOC 里的 `fn apply …`。
 * lambda 不是裸 JS 函数而是「带 apply 方法的 ObjectValue」，宿主注入的
 * 全局对象（如 loop）要执行它必须走这里。
 */
export function invoke(fn: unknown, args: unknown[] = []): any {
  // 兼容 toNativeCallback 包出的 JS 函数：直接走原始 lambda，绕开 apply 劫持
  const origin = (fn as { $$oocCall?: object } | null)?.$$oocCall
  if (origin) {
    return sendMessage(origin, 'apply', args)
  }
  return sendMessage(fn, 'apply', args)
}
