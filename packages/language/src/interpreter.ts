import { KVPair } from 'wy-helper'
import {
  ExceptionCatch,
  Expression,
  Method,
  Model,
  Primary,
  Message,
  StID,
} from './generated/ast.js'

// 定义值类型
export type Value = number | string | boolean | null | ObjectValue

export class ObjectValue {
  constructor(
    readonly methods: Method[],
    readonly scope: Scope,
  ) {}
  send(name: string, args: any[]) {
    const method = this.methods.find((v) => v.name == name)
    if (!method) {
      throw new Error(`没有定义该方法${name}`)
    }
    switch (method.$type) {
      case 'MethodBind':
        const cache = method as Method & {
          cache: any
          cached: boolean
        }
        if (!cache.cached) {
          cache.cache = interpretExpression(method.expression, this.scope)
          cache.cached = true
        }
        return cache.cache
      case 'MethodAll':
        let s = addScope(this.scope, 'this', this)
        s = addScope(s, 'args', args)
        s = addScope(s, 'methodName', name)
        method.params.forEach((param, index) => {
          s = addScope(s, param, args[index])
        })
        method.beforeExpressions.forEach((e) => {
          switch (e.$type) {
            case 'Assignment':
              s = addScope(s, e.name, interpretExpression(e.expression, s))
              return
            case 'ExceptionCatch':
              s = interpretExpressionCatch(e, s)
              return
            default:
              interpretExpression(e, s)
              return
          }
        })
        return interpretExpression(method.expression, s)
    }
  }
}

function interpretExpressionCatch(e: ExceptionCatch, scope: Scope): any {
  try {
    const value = interpretExpression(e.expression, scope)
    scope = addScope(scope, e.error, null)
    scope = addScope(scope, e.name, value)
  } catch (err) {
    scope = addScope(scope, e.error, err)
    scope = addScope(scope, e.name, null)
  }
  return scope
}

export function interpret(model: Model, scope: Scope) {
  // 收集导入语句
  const imports = model.beforeExpressions.filter(
    (x) => x.$type == 'ImportStatement',
  )

  // 处理导入（支持动态加载模块）
  imports.forEach((importStmt) => {
    if (importStmt.$type === 'ImportStatement') {
      // 导入模块路径（去掉引号）
      const modulePath = importStmt.path.replace(/^'(.*)'$/, '$1')
      // 将模块注册到作用域中，可用于后续的动态加载
      // 这里暂时只记录导入的信息，具体的加载逻辑取决于运行环境
      try {
        // 可以在这里添加动态导入的逻辑
        // 例如：const module = await import(modulePath)
        // scope = addScope(scope, importStmt.name, module)
      } catch (err) {
        console.warn(`Failed to import module: ${modulePath}`)
      }
    }
  })

  model.beforeExpressions.forEach((e) => {
    switch (e.$type) {
      case 'Assignment':
        scope = addScope(
          scope,
          e.name,
          interpretExpression(e.expression, scope),
        )
        return
      case 'ImportStatement':
        return
      case 'ExceptionCatch':
        scope = interpretExpressionCatch(e, scope)
        return
      default:
        interpretExpression(e, scope)
        return
    }
  })
  return interpretExpression(model.expression, scope)
}

function interpretExpression(e: Expression, scope: Scope): any {
  switch (e.$type) {
    case 'MessageOrChain':
      const o = interpretPrimary(e.primary, scope)
      if (e.message) {
        return sendMessageWith(o, e.message, scope)
      }
      return o
    default:
      const obj = interpretExpression(e.left, scope)
      const r = e.right
      switch (r.$type) {
        case 'Message':
          return sendMessageWith(obj, r, scope)
        case 'MessageChain':
          const args = r.message.args.map((arg) => interpretPrimary(arg, scope))
          args.unshift(obj)
          const main = interpretPrimary(r.primary, scope)
          return sendMessage(main, r.message.name, args)
        default:
          scope = addScope(scope, r.param, obj)
          const re = r.expression
          switch (re.$type) {
            case 'MessageChain':
              const o = interpretPrimary(re.primary, scope)
              return sendMessageWith(o, re.message, scope)
            default:
              return interpretPrimary(re, scope)
          }
      }
  }
}

function sendMessageWith(o: any, message: Message, scope: Scope) {
  const name = message.name
  const args = message.args.map((arg) => interpretPrimary(arg, scope))
  return sendMessage(o, name, args)
}

const boolBuildIn = {
  and: function (a: boolean, b: boolean) {
    return a && b
  },
  or: function (a: boolean, b: boolean) {
    return a || b
  },
  not: function (a: boolean) {
    return !a
  },
}
const numberBuildIn = {
  // 数值方法
  add: function (a: number, b: number) {
    return a + b
  },
  sub: function (a: number, b: number) {
    return a - b
  },
  mul: function (a: number, b: number) {
    return a * b
  },
  div: function (a: number, b: number) {
    return a / b
  },
  mod: function (a: number, b: number) {
    return a % b
  },
  concat: function (a: string, b: string) {
    return a + b
  },
  // 比较操作
  eq: function (a: any, b: any) {
    return a === b
  },
  neq: function (a: any, b: any) {
    return a !== b
  },
  lt: function (a: any, b: any) {
    return a < b
  },
  gt: function (a: any, b: any) {
    return a > b
  },
  lte: function (a: any, b: any) {
    return a <= b
  },
  gte: function (a: any, b: any) {
    return a >= b
  },
}

function sendMessage(o: any, name: string, args: any[]) {
  if (o instanceof ObjectValue) {
    return o.send(name, args)
  }
  const tp = typeof o
  if (tp == 'number') {
    //数字类型扩展方法
    const fun = numberBuildIn[name as 'add'] as any
    if (fun) {
      return fun(o, ...args)
    }
  }
  if (tp == 'boolean') {
    //布尔类型扩展方法
    const fun = boolBuildIn[name as 'and'] as any
    if (fun) {
      return fun(o, ...args)
    }
  }
  //普通js对象
  return o[name].apply(o, args)
}

function interpretPrimary(e: Primary, scope: Scope) {
  switch (e.$type) {
    case 'Bool':
      return e.value == 'true'
    case 'Nil':
      return null
    case 'Num':
      return e.value
    case 'Ref':
      return getScope(scope, e.value)
    case 'ObjectDef':
      return new ObjectValue(e.methods, scope)
    case 'StID':
      const n = e as StID & {
        xvalue: string
      }
      if (!n.xvalue) {
        n.xvalue = n.value.slice(1)
      }
      return n.xvalue
    case 'Str':
      console.log('str', e.value)
      return e.value
    default:
      return interpretExpression(e, scope)
  }
}

interface RootScope {
  get(key: string): any
}

type Scope = KVPair<any> | undefined

function addScope(scope: Scope, key: string, value: any) {
  return new KVPair(key, value, scope)
}
function getScope(scope: Scope, key: string) {
  if (scope) {
    const kv = scope.get(key)
    if (kv) {
      return kv.value
    }
  }
  return globalRoot.get(key)
}
const extendGlobalObject = {
  JSAttr: {
    get(obj: any, name: string) {
      return obj[name]
    },
    set(obj: any, name: string, value: any) {
      obj[name] = value
      return value
    },
  },
}

const globalRoot: RootScope = {
  get(key: string): any {
    if (key in extendGlobalObject) {
      return extendGlobalObject[key as 'JSAttr']
    }
    if (key in global) {
      return global[key as 'Object']
    }
    throw new Error(`not foun define for ${key}`)
  },
}

/**
 * 执行 OOC 模型的入口函数
 */
export function executeOOC(model: Model): any {
  return interpret(model, undefined)
}
