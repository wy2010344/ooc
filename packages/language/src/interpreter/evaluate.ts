import { dirnameOf } from '../module-path.js'
import {
  Expression,
  ImportStatement,
  LambdaDef,
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
  bindMethod,
  runBody,
} from './runtime.js'
import { addScope, getScope, type Scope } from './scope.js'

export type InterpretAction = (name: string, basePath?: string) => Promise<ModuleRun>

/**
 * 模块执行记录：last 是默认导出（最后一条表达式的结果），named 是所有顶层声明
 * （赋值/导入绑定/类型名占位）。#import 默认导入取 last、命名导入取 named[name]。
 */
export interface ModuleRun {
  last: any
  named: Record<string, unknown>
}

/**
 * 最近一次求值的表达式所在位置（0 基行/列，来自 CST）。解释器在每一步
 * interpretExpression/interpretPrimary 里覆盖更新，O(1) 零开销；
 * 同步执行（import 用 await 无用户代码并发），模块级游标安全。
 * 错误逃逸到 createInterpretAction 边界时被消费，拼成 `at <文件>:<行>:<列>`。
 */
let errorPosition: { line: number; character: number } | null = null

/** 新一轮解释前清空位置游标（import 加载的异文档错误不应污染主文档坐标）。 */
export function clearErrorPosition(): void {
  errorPosition = null
}

/** 取走最近一次求值位置并清空（宿主边界消费一次）。无位置返回 null。 */
export function consumeErrorPosition(): {
  line: number
  character: number
} | null {
  const p = errorPosition
  errorPosition = null
  return p
}

function track(
  node:
    | { $cstNode?: { range: { start: { line: number; character: number } } } }
    | undefined,
): void {
  const pos = node?.$cstNode?.range.start
  if (pos) {
    errorPosition = pos
  }
}

export async function interpret(
  model: Model,
  scope: Scope,
  rootPath: string,
  interpretAction: InterpretAction,
): Promise<ModuleRun> {
  clearErrorPosition()
  // 收集导入语句（默认/命名/类型导入共用 ImportStatement 类型）
  const imports = model.expressions.filter(
    (x) => x.$type === 'ImportStatement',
  ) as ImportStatement[]
  // 只有需要模块运行时值时才执行目标模块：
  // 默认导入（有 name）与命名导入（named，可能是值）需要；纯类型导入（仅 types）不需要
  const needRun = imports.filter(
    (s) => s.name !== undefined || s.named !== undefined,
  )
  const runs = await Promise.all(
    needRun.map((importStmt) =>
      interpretAction(importStmt.path, dirnameOf(rootPath)),
    ),
  )
  // 语句 → 运行结果；纯类型导入（只有 types）不在表里，绑定处按 undefined 处理
  const recordByStmt = new Map<ImportStatement, ModuleRun>()
  needRun.forEach((s, i) => recordByStmt.set(s, runs[i]))
  const named: Record<string, unknown> = {}
  let last: any = null
  model.expressions.forEach((e) => {
    switch (e.$type) {
      case 'Assignment':
        // 顶层赋值也是模块命名导出（语义：所有顶层声明都是导出）
        const assignmentValue = interpretExpression(e.expression, scope)
        named[e.name] = assignmentValue
        scope = addScope(scope, e.name, assignmentValue)
        return
      case 'ImportStatement': {
        const record = recordByStmt.get(e)
        if (e.name) {
          // 默认导入：模块默认导出 = 最后一条表达式的结果
          const value = record ? record.last : undefined
          named[e.name] = value
          scope = addScope(scope, e.name, value)
        }
        if (e.named) {
          // 命名导入：绑定模块对应的顶层声明；类型声明运行时无值，占位 undefined
          for (const item of e.named.items) {
            const key = item.alias ?? item.name
            const value = record ? record.named[item.name] : undefined
            named[key] = value
            scope = addScope(scope, key, value)
          }
        }
        // types 类型导入运行时无值：忽略
        return
      }
      case 'TypeDef':
        // 类型声明只是装饰，运行时无副作用；名字仍作为模块命名导出占位
        named[e.name] = undefined
        return
      default:
        last = interpretExpression(e as Expression, scope)
        return
    }
  })
  return { last, named }
}

export function interpretExpression(e: Expression, scope: Scope): any {
  track(e)
  switch (e.$type) {
    case 'CastExpression':
      // 类型断言是静态的，运行时直接返回表达式的值
      return interpretExpression(e.expression, scope)
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
  track(e)
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
      return objectValue(e.methods, scope)
    case 'LambdaDef':
      // lambda 等价于 { apply(...) { ... } }，合成一个 apply 方法
      return createLambdaValue(e, scope)
    case 'StID':
      return getStId(e)
    case 'Str':
      return getStrValue(e)
    case 'CastExpression':
      // 类型断言是静态的，运行时直接返回表达式的值
      return interpretExpression(e.expression, scope)
    default:
      return interpretExpression(e, scope)
  }
}

/**
 * lambda `[x -> body]` 就像 JS 箭头函数：直接解释成真正的 JS 函数。
 * 这样宿主原生方法（Array.forEach/map 等）天然能调用它，先复用 JS 生态；
 * `fn apply x` 在 sendMessage 里对函数接收者特判为 fn(x)。
 * 注意：因此 lambda 没有 OOC 对象语义（无原型、无兜底），
 * 需要对象语义时用 `{ apply(x) { ... } }`。
 */
function createLambdaValue(e: LambdaDef, scope: Scope): Function {
  // 合成的匿名 apply 方法：只读 params/expressions，供 bindMethod/runBody 使用；
  // 不需要真实 $container 等链接信息。l
  // 箭头式：函数体始终在自己的作用域 + 参数作用域中求值，self 即函数本身
  const fn = function (...args: unknown[]) {
    const s = bindMethod(e, scope, fn, args)
    return runBody(e.expressions, s)
  }
  return fn
}
