import { dirnameOf } from '../module-path.js'
import {
  Expression,
  LambdaDef,
  MethodAll,
  Model,
  Primary,
  StID,
  Str,
} from '../generated/ast.js'
// 注意：与 runtime.ts 互为依赖（运行时求值），都是函数/类级别引用、
// 模块初始化时不互相调用，ESM 循环依赖安全。
import {
  objectValue,
  getMethodCallName,
  sendMessage,
  sendMessageWith,
  type ObjectValue,
} from './runtime.js'
import { addScope, getScope, type Scope } from './scope.js'

export type InterpretAction = (name: string, basePath?: string) => Promise<any>

export async function interpret(
  model: Model,
  scope: Scope,
  rootPath: string,
  interpretAction: InterpretAction,
) {
  // 收集导入语句（ImportStatement 与 ImportList 均为导入）
  const imports = model.expressions.filter(
    (x) => x.$type === 'ImportStatement' || x.$type === 'ImportList',
  ) as Array<{ path: string; name: string; $type: string }>
  // 处理导入：传原始路径和基准目录，由 interpretAction 统一解析（避免双重解析）
  const out = await Promise.all(
    imports.map((importStmt) =>
      interpretAction(importStmt.path, dirnameOf(rootPath)),
    ),
  )
  let last: any = null
  let importIndex = 0
  model.expressions.forEach((e) => {
    switch (e.$type) {
      case 'Assignment':
        scope = addScope(
          scope,
          e.name,
          interpretExpression(e.expression, scope),
        )
        return
      case 'ImportStatement':
      case 'ImportList':
        const value = out[importIndex]
        scope = addScope(scope, e.name, value)
        importIndex++
        return
      case 'TypeDef':
        //类型声明只是装饰，运行时无副作用
        return
      default:
        last = interpretExpression(e, scope)
        return
    }
  })
  return last
}

export function interpretExpression(e: Expression, scope: Scope): any {
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
        case 'MessageChainExt':
          return sendMessageWith(obj, r.value, scope)
        case 'MessagePipRight':
          const rv = r.value
          switch (rv.$type) {
            case 'MessageChain':
              const args = rv.message.args.map((arg) =>
                interpretPrimary(arg, scope),
              )
              args.unshift(obj)
              const main = interpretPrimary(rv.primary, scope)
              return sendMessage(main, getMethodCallName(rv.message.name), args)
            default:
              scope = addScope(scope, rv.param, obj)
              return interpretExpression(rv.expression, scope)
          }
        default:
          return sendMessage(obj, r.infix, [interpretPrimary(r.value, scope)])
      }
  }
}

export function getStId(e: StID) {
  const n = e as StID & {
    xvalue: string
  }
  if (!n.xvalue) {
    n.xvalue = n.value.slice(1)
  }
  return n.xvalue
}

export function getStrValue(e: Str) {
  // console.log('str', e.value)
  return e.value
}

export function interpretPrimary(e: Primary, scope: Scope): any {
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
      return objectValue(
        e.methods,
        scope,
        e.extends ? interpretPrimary(e.extends, scope) : undefined,
      )
    case 'LambdaDef':
      // lambda 等价于 { apply(...) { ... } }，合成一个 apply 方法
      return createLambdaValue(e, scope)
    case 'StID':
      return getStId(e)
    case 'Str':
      return getStrValue(e)
    default:
      return interpretExpression(e, scope)
  }
}

/**
 * lambda `[x -> body]` 与对象 `{ apply(x) { body } }` 语义相同：
 * 生成一个只包含 apply 方法的 ObjectValue。
 */
function createLambdaValue(e: LambdaDef, scope: Scope): ObjectValue {
  // 合成的 apply 方法节点：运行时只读取 name/params/restParam/guardExpression/expressions，
  // $container 等链接信息由 Langium 在真实解析时填充，此处不需要。
  const applyMethod = {
    $type: 'MethodAll',
    name: {
      $type: 'MethodDefName',
      name: { $type: 'Ref', value: 'apply' },
    },
    params: e.params,
    expressions: e.expressions,
  } as unknown as MethodAll
  return objectValue([applyMethod], scope, undefined)
}
