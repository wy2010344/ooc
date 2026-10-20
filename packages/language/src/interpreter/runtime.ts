import { literalOfBindBody, literalToValue } from '../member-kind.js'
import {
  Expression,
  Method,
  MethodCallName,
  MethodDefName,
  Message,
  MessageArg,
  Statement,
  MethodAll,
  MethodBind,
  MethodBindMutable,
  isBindBlock,
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

/** bind / mutable 的惰性绑定：首次访问时求值 body 并缓存（bind 恒返构造值、
 *  mutable 为委托对象）。纯字面量 bind 不走这里——构造期直接写成数据属性。 */
type LazyBind = {
  method: MethodBind | MethodBindMutable
  scope: Scope
  done: boolean
  value: unknown
}

// 定义值类型
export type Value = number | string | boolean | null | object

export function getObjDefineName(n: MethodDefName) {
  const v = n.name
  switch (v.$type) {
    case 'Ref':
      return v.value
    case 'StID':
      return v.value.slice(1)
    case 'Str':
      return getStrValue(v)
    case 'Dollar':
      // 定义键、消息名、中缀运算符三处都写 `$`：成员名就是 `$`
      return '$'
  }
}

/** 执行一个方法体：把参数（含 rest）绑进作用域后逐条求值表达式，返回最后一条的值。
 *  OOC 对象方法与原生 JS 函数型 lambda（见 evaluate.ts createLambdaValue）共用，
 *  receiver 绑定到 `this`（方法体内引用接收者）。guard 需引用参数时，先 bindMethod
 *  再在返回的作用域上求值。 */
export function bindMethod(
  method: {
    params: Array<{ name: string }>
    restParam?: { name: string } | null
  },
  baseScope: Scope,
  receiver: unknown,
  args: unknown[],
): Scope {
  let s = addScope(baseScope, 'this', receiver)
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

/** 在已绑定参数的作用域上逐条执行方法体语句，返回最后一条的值。 */
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
export function objectValue(methods: Method[], scope: Scope) {
  // 空对象 {} 快速返回共享单例（无方法时）
  if (methods.length === 0) {
    return EMPTY_OBJECT
  }
  // 直接新建普通对象 {}，保留 Object.prototype，JS 侧 toString/拼接等原生能力可用。
  const obj: Record<string, unknown> = {}
  // 计算绑定/mutable 的惰性求值：首次访问时求值 body 并缓存（this 绑定到本对象）
  const lazyValue = (bind: LazyBind): unknown => {
    if (bind.done) {
      return bind.value
    }
    const body = bind.method.bindBody
    const s = addScope(bind.scope, 'this', obj)
    bind.value = isBindBlock(body)
      ? runBody(body.bindStmts, s)
      : interpretExpression(body.expression, s)
    bind.done = true
    return bind.value
  }
  // 字面量绑定 → 数据属性（构造期求值一次，语义恒定）。定为只读：常量不因
  // 发消息带参而被改写（与旧 getter 行为一致）。
  const writeValue = (name: string, value: unknown) => {
    Object.defineProperty(obj, name, {
      enumerable: true,
      writable: false,
      value,
    })
  }
  // 方法属性：只读数据函数（每次发消息调用）。成员形态只看 descriptor——
  // getter＝绑定值原样返回，数据函数＝方法调用。
  const writeMethod = (name: string, fn: (...args: unknown[]) => unknown) => {
    Object.defineProperty(obj, name, { enumerable: true, value: fn })
  }
  for (const method of methods) {
    const name = getObjDefineName(method.name)
    // 同名成员派发取首个定义（唯一性由校验器保证）：已挂载的名字跳过后续定义，
    // 否则 defineProperty 会因不可重定义而抛错。签名方法（无 body）不挂载，
    // 故不会挡住同名的实现方法。
    if (name === undefined || Object.prototype.hasOwnProperty.call(obj, name)) {
      continue
    }
    switch (method.$type) {
      case 'MethodBind': {
        // 纯字面量绑定 → 构造期求值一次写成数据属性；计算绑定 → getter 惰性一次缓存
        const lit = literalOfBindBody(method.bindBody)
        if (lit) {
          writeValue(name, literalToValue(lit))
          break
        }
        const bind: LazyBind = { method, scope, done: false, value: undefined }
        Object.defineProperty(obj, name, {
          enumerable: true,
          get() {
            return lazyValue(bind)
          },
        })
        break
      }
      case 'MethodBindMutable': {
        // 转发属性：本 key 上的一切消息原样转发给委托对象的 `$`
        //（消息名不传给 $，只传实参），委托对象惰性求值一次缓存。
        const bind: LazyBind = { method, scope, done: false, value: undefined }
        writeMethod(name, function (this: unknown) {
          return sendMessage(lazyValue(bind), '$', Array.from(arguments))
        })
        break
      }
      default: {
        // 签名方法（无 body）是纯书写期类型契约，运行时无行为，不烧录
        if (method.$type === 'MethodAll' && !method.body) {
          break
        }
        const m = method as MethodAll
        writeMethod(name, function (this: unknown) {
          return runGuardedBody(m, scope, this, Array.from(arguments))
        })
      }
    }
  }
  return obj
}

/**
 * 执行一个方法体，支持 #guard 分支链（if / else-if / else 语义）：
 *   先执行 #guard 之前的语句（赋值更新作用域，表达式求值有副作用），
 *   再进入分支判别：命中即执行该分支语句并返回；
 *   全不命中则执行 #else 分支（无 #else 时返回 nil）；
 *   无分支时返回前置语句最后一条的值（与 runBody 一致）。
 */
function runGuardedBody(
  method: MethodAll,
  scope: Scope,
  receiver: unknown,
  args: unknown[],
): unknown {
  const body = method.body
  let s = bindMethod(method, scope, receiver, args)
  const preStmts = (body?.stmts ?? []) as Array<Expression | Statement>
  let last: unknown = null
  for (const e of preStmts) {
    if (e.$type === 'Assignment') {
      s = addScope(s, e.name, interpretExpression(e.expression, s))
    } else {
      last = interpretExpression(e, s)
    }
  }
  const branches = body?.guardBranches ?? []
  if (branches.length === 0 && !body?.elseBranch) {
    return last
  }
  for (const branch of branches) {
    if (interpretExpression(branch.guardExpression, s)) {
      return runBody(branch.stmts as Expression[], s)
    }
  }
  return body?.elseBranch
    ? runBody(body.elseBranch.stmts as Expression[], s)
    : null
}

export function getMethodCallName({ value }: MethodCallName) {
  switch (value.$type) {
    case 'StID':
      return value.value.slice(1)
    case 'Str':
      return getStrValue(value)
    case 'Dollar':
      // `$` 直接调用：消息名就是 `$`
      return '$'
    default:
      return value.value
  }
}

/** 展开单个消息实参：`...expr` 若求值为数组则摊平成多个实参，否则整体作为单个实参。 */
export function spreadArg(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [value]
}

/** 求值消息实参列表，`...` 展开参数按元素摊平（与 codegen 语义一致）。 */
export function interpretMessageArgs(
  args: MessageArg[],
  scope: Scope,
): unknown[] {
  const out: unknown[] = []
  for (const arg of args) {
    const value = interpretPrimary(arg.value, scope)
    if (arg.spread) {
      out.push(...spreadArg(value))
    } else {
      out.push(value)
    }
  }
  return out
}

export function sendMessageWith(o: any, message: Message, scope: Scope) {
  const name = message.name
  const args = interpretMessageArgs(message.args, scope)
  return sendMessage(o, getMethodCallName(name), args)
}

export function sendMessage(o: any, value: string, args: any[]): any {
  if (typeof o == 'function' && value == '$') {
    // 函数接收者：lambda 直接当函数调用
    return o.apply(o, args)
  }
  // descriptor 优先：属性成员（getter）单次读取、结果原样返回——即使结果是
  // lambda 也绝不二次调用；数据属性带参写入、无参读取；数据函数仍按方法调用。
  // 无 own descriptor（原型链方法 / Proxy / 宿主内建）走下方回退链。
  const desc =
    o == null || (typeof o !== 'object' && typeof o !== 'function')
      ? undefined
      : Object.getOwnPropertyDescriptor(o, value)
  if (desc) {
    if (desc.get || desc.set) {
      if (args.length && desc.set) {
        desc.set.call(o, args[0])
        return o[value]
      }
      // 只读 getter（或无实参读取）：取值一次，函数值原样透传
      return desc.get ? desc.get.call(o) : undefined
    }
    if (typeof desc.value === 'function') {
      // 数据函数＝方法（OOC 方法或宿主方法）→ 调用。lambda 值不会以数据属性出现
      // 以数据属性出现（绑定里的 lambda 走 getter），故这里调用对两者都安全。
      return desc.value.apply(o, args)
    }
    // 数据非函数属性：带参且可写才写入，否则读取（常量/只读属性忽略实参）
    if (args.length && desc.writable) {
      o[value] = args[0]
    }
    return o[value]
  }
  const fun = o?.[value]
  if (typeof fun == 'function') {
    //方法
    return fun.apply(o, args)
  }
  if (value in Object(o)) {
    //属性读取与设置
    if (args.length) {
      o[value] = args[0]
    }
    return o[value]
  }
  // send：通用消息——把「接收者 + 消息名 + 参数」交回运行时动态派发。
  // 任意值都可接收：`map send 'key'` ≡ 读取 map 上的 key（等价 JS 的 map[key]）。
  // 参数约定同 js send：唯一数组参数视为完整参数列表（便于 rest 转发）。
  if (value === 'send') {
    const name = args[0]
    const params =
      args.length === 2 && Array.isArray(args[1]) ? args[1] : args.slice(1)
    return sendMessage(o, String(name), params)
  }
  const num = numDef[value as '<']
  if (num) {
    return num(o, args[0])
  }
  const obj = objectDefine[value as '||']
  if (obj) {
    return obj(o, args[0])
  }
  // 没有兜底：需要拦截未知消息的对象已用 `js proxy` 显式包成 JS Proxy
  // （get trap 动态转发），到这里就是真的没有接收方了，直接抛结构化错误。
  throw new OocMethodNotFoundError(o, value, args)
}
