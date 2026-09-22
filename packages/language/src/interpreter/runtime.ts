import { emptyMap, groupToMap } from 'wy-helper'
import {
  Expression,
  Method,
  MethodCallName,
  MethodDefName,
  Message,
  Statement,
  MethodAll,
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

/** 对象元信息：只含本层定义，无继承。
 *  Map 键是消息名，值是同名定义（bind/mutable/call，含 guard 重载）的完整列表——
 *  不在烧录期折叠，宿主可据 value 字段直接消费（bind/mutable 挂着缓存值、call 挂方法）。 */
export type OocMeta = Map<
  string,
  (
    | {
        type: 'bind'
        name: string
        value: any
      }
    | {
        type: 'mutable'
        name: string
        value: unknown
      }
    | {
        type: 'call'
        name: string
        value: MethodAll
      }
  )[]
>

/** 读值上的元信息；非 OOC 定义值（lambda/宿主值/原始值）返回 undefined */
export function readOocMeta(v: unknown): OocMeta | undefined {
  if (v && typeof v == 'object') {
    return (v as Record<symbol, unknown>)[OOC_META] as OocMeta | undefined
  }
  return undefined
}

/** 创建元信息：非枚举挂到对象上，构造时烧录、事后不可伪造 */
function attachMeta(target: object, members: OocMeta): void {
  Object.defineProperty(target, OOC_META, {
    enumerable: false,
    value: members,
  })
}

// 空对象也烧录元信息：`{}` 同样是语言定义值（members 为空）
attachMeta(EMPTY_OBJECT, emptyMap)

// 定义值类型
export type Value = number | string | boolean | null | OocObject

export function getObjDefineName(n: MethodDefName) {
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
export function objectValue(methods: Method[], scope: Scope) {
  // 空对象 {} 快速返回共享单例（无方法时）
  if (methods.length === 0) {
    return EMPTY_OBJECT
  }
  // 直接新建普通对象 {}，保留 Object.prototype，JS 侧 toString/拼接等原生能力可用。
  const obj = {}
  const meta = groupToMap(
    methods.map((method) => {
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
          // 签名方法（无 body）是纯书写期类型契约，运行时无行为，不烧录
          if (method.$type == 'MethodAll' && !method.body) {
            return undefined
          }
          return {
            type: 'call' as const,
            name: getObjDefineName(method.name),
            value: method,
          }
      }
    }).filter((item) => item !== undefined),
    getName,
  )
  attachMeta(obj, meta)
  meta.forEach(function (methods, name) {
    // 所有定义（含 bind）统一作为方法函数，bind 在函数体内直接返回绑定值
    Object.defineProperty(obj, name, {
      enumerable: true,
      value() {
        const args = arguments
        for (let i = 0; i < methods.length; i++) {
          const pair = methods[i]
          switch (pair.type) {
            case 'bind':
              // bind 只匹配无参调用，有参数时跳过，让后面的 call 方法处理
              if (arguments.length === 0) {
                return pair.value
              }
              continue
            case 'mutable':
              // mutable 匹配0或1个参数（getter/setter），2+参数时跳过
              if (arguments.length <= 1) {
                if (arguments.length > 0) {
                  ;(pair as { value: unknown }).value = arguments[0]
                }
                return pair.value
              }
              continue
            case 'call':
              const method = pair.value
              // 计算方法期望的参数数量
              const minArgs = method.params.length
              const hasRest = !!method.restParam
              
              // 如果没有 guard，自动检查参数数量是否匹配
              if (!method.body?.guardExpression) {
                // 固定参数方法：调用参数数量必须恰好匹配
                // 可变参数方法：调用参数数量必须 >= minArgs
                const argsMatch = hasRest 
                  ? arguments.length >= minArgs 
                  : arguments.length === minArgs
                
                if (!argsMatch) {
                  continue  // 参数数量不匹配，跳过这个方法
                }
              }
              
              // 先绑参数再求值 guard：guard 可引用参数（`#guard a > 5`）
              const s = bindMethod(
                method,
                scope,
                this,
                arguments as unknown as unknown[],
              )
              if (
                !method.body?.guardExpression ||
                (method.body?.guardExpression &&
                  interpretExpression(method.body.guardExpression, s))
              ) {
                return runBody(method.body?.expressions ?? [], s)
              }
          }
        }
        // 本层同名方法 guard 全不通过：走通用对象方法 / methodNotFound 兜底。
        // 无继承，不会沿原型链查找上层同名方法。
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
  return obj
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

export function sendMessage(o: any, value: string, args: any[]): any {
  if (typeof o == 'function' && value == 'apply') {
    //lambda需要特殊处理
    return o.apply(o, args)
  }
  const fun = o?.[value]
  if (typeof fun == 'function') {
    //方法
    return fun.apply(o, args)
  }
  if (value === 'methodNotFound') {
    // 此处是未知消息的最终兜底：上一次派发已将原消息名放在第一个实参。
    // 保留它可让宿主准确判断究竟是哪条 OOC 消息未被处理。
    const [methodName, ...methodArgs] = args
    if (typeof methodName === 'string') {
      throw new OocMethodNotFoundError(o, methodName, methodArgs)
    }
    //应该绝对不会到达这里
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
