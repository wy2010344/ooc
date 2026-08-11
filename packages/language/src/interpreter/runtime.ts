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
          throw new TypeError(`没有定义该方法${name}`)
        }
        return sendMessage(this, 'methodNotFound', [name, ...args])
      },
    })
  })
  return currentObject
}

// type ObjectMethod =
//   | {
//       type: 'call'
//       name: string
//       value: MethodAll
//     }
//   | {
//       name: string
//       type: 'bind'
//       value: any
//     }
/***
 * 好像并不能和js的原型对象一一匹配，主要是guard的策略，可以路由到父节点去处理。
 */
// export class ObjectValue {
//   readonly methods: ObjectMethod[]
//   private scope: Scope
//   constructor(
//     methods: Method[],
//     scope: Scope,
//     readonly parent: ObjectValue | undefined,
//   ) {
//     if (parent != undefined && !(parent instanceof ObjectValue)) {
//       throw new Error(`parent 应该是一个ObjectValue`)
//     }
//     scope = addScope(scope, 'currentObject', this)
//     this.methods = methods.map((method, i) => {
//       switch (method.$type) {
//         case 'MethodBind':
//           return {
//             type: 'bind',
//             name: getObjDefineName(method.name),
//             value: interpretExpression(method.expression, scope),
//           }
//         default:
//           return {
//             type: 'call',
//             name: getObjDefineName(method.name),
//             value: method,
//           }
//       }
//     })
//     this.scope = scope
//   }
//   send(name: string, responser: any, args: any[]): any {
//     for (let i = 0; i < this.methods.length; i++) {
//       const pair = this.methods[i]
//       if (pair.name == name) {
//         switch (pair.type) {
//           case 'bind':
//             return pair.value
//           case 'call':
//             const method = pair.value
//             let s = addScope(this.scope, 'responser', responser)
//             method.params.forEach((param, index) => {
//               s = addScope(s, param.name, args[index])
//             })

//             if (method.restParam) {
//               s = addScope(
//                 s,
//                 method.restParam.name,
//                 args.slice(method.params.length),
//               )
//             }
//             if (
//               !method.guardExpression ||
//               (method.guardExpression &&
//                 interpretExpression(method.guardExpression, s))
//             ) {
//               //继续
//               let last = null
//               method.expressions.forEach((e) => {
//                 switch (e.$type) {
//                   case 'Assignment':
//                     s = addScope(
//                       s,
//                       e.name,
//                       interpretExpression(e.expression, s),
//                     )
//                     return
//                   default:
//                     last = interpretExpression(e, s)
//                     return
//                 }
//               })
//               return last
//             }
//         }
//       }
//     }
//     //继承：自身没有，向上查找父对象
//     if (this.parent) {
//       return this.parent.send(name, responser, args)
//     }
//     //通用对象方法
//     const fun = objectDefine[name as '&&']
//     if (fun) {
//       return fun(this, args[0])
//     }
//     if (name == 'methodNotFound') {
//       throw new TypeError(`没有定义该方法${name}`)
//     }
//     return sendMessage(this, 'methodNotFound', [name, ...args])
//   }
// }

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
    throw new TypeError(`没有定义该方法${value}`)
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
