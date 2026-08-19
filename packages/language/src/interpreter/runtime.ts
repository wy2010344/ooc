import { groupToMap } from 'wy-helper'
import {
  Method,
  MethodCallName,
  MethodDefName,
  Message,
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

// 定义值类型
export type Value = number | string | boolean | null | ObjectValue

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
export type ObjectValue = object
function getName(n: { name: string }) {
  return n.name
}
export function objectValue(
  methods: Method[],
  scope: Scope,
  parent: ObjectValue | undefined,
) {
  // 空对象 {} 快速返回共享单例（无 parent 且无方法时）
  if (methods.length === 0 && !parent) {
    return EMPTY_OBJECT
  }
  // 顶层对象（无 parent）直接新建普通对象 {}，而非 Object.create(null)，
  // 保留 Object.prototype，JS 侧 toString/拼接等原生能力可用。
  const currentObject = parent ? Object.create(parent) : {}
  scope = addScope(scope, 'currentObject', currentObject)
  groupToMap(
    methods.map((method) => {
      switch (method.$type) {
        case 'MethodBind':
          return {
            type: 'bind',
            name: getObjDefineName(method.name),
            value: interpretExpression(method.expression, scope),
          } as const
        case 'MethodBindMutable':
          return {
            type: 'mutable' as const,
            name: getObjDefineName(method.name),
            value: interpretExpression(method.expression, scope) as unknown,
          }
        default:
          return {
            type: 'call',
            name: getObjDefineName(method.name),
            value: method,
          } as const
      }
    }),
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
              let s = addScope(scope, 'responser', this)
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
              if (
                !method.guardExpression ||
                (method.guardExpression &&
                  interpretExpression(method.guardExpression, s))
              ) {
                //继续
                let last = null
                method.expressions.forEach((e) => {
                  switch (e.$type) {
                    case 'Assignment':
                      s = addScope(
                        s,
                        e.name,
                        interpretExpression(e.expression, s),
                      )
                      return
                    default:
                      last = interpretExpression(e, s)
                      return
                  }
                })
                return last
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

export function sendMessage(o: any, value: string, args: any[]): any {
  // if (o instanceof ObjectValue) {
  //   return o.send(value, o, args)
  // }
  const fun = o[value]
  if (typeof fun === 'function') {
    //能找到对象方法定义，包括proxy其实也在里面
    return fun.apply(o, args)
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
  return sendMessage(fn, 'apply', args)
}
