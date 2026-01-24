/**
 * OOC Language Interpreter
 *
 * Executes OOC AST nodes based on the new grammar (Langium 4.1)
 * Supports: message passing, pipelines, closures, objects, and macros
 */

import type {
  OOCModel,
  Message,
  Primary,
  ObjectLiteral,
  CachedMember,
  IfMacro,
  WhileMacro,
  Expression,
  ExpressionBody,
  TopLevelItem,
} from './generated/ast.js'

export type OOCValue =
  | OOCObject
  | OOCUnion
  | string
  | number
  | boolean
  | undefined
export class OOCObject {
  constructor(private parentEnv: Environment, private methods: ObjectLiteral) {}
  sendMessage(name: string, msgs: any[]) {
    const method = this.methods.members.find((x) => x.name == name)
    if (method) {
      switch (method.$type) {
        case 'CachedMember':
          const m = method as CachedMember & {
            cached?: boolean
            cache?: OOCValue
          }
          if (m.cached) {
            return m.cache
          }
          m.cached = true
          m.cache = this.parentEnv.evaluateExpression(method.value)
          return m.cache
          return
        case 'MethodMember':
          const scope = new EnvironmentI(this.parentEnv)
          return
        case 'VariableMember':
          method
          return
      }
    }
    throw new Error(`未找到方法定义`)
  }
}
export class OOCUnion {
  constructor(readonly name: string, readonly args: any[]) {}
}

class ReturnValue {
  constructor(readonly value: any) {}
}
abstract class Environment {
  abstract define(name: string, value: OOCValue): void
  abstract get(name: string): OOCValue

  private evaluatePrimary(primary: Primary): OOCValue {
    switch (primary.$type) {
      case 'ObjectLiteral':
        return new OOCObject(this, primary)
      case 'StringLiteral':
        //先简单处理
        return primary.value.slice(1, -1)
      case 'NumberLiteral':
        return Number(primary.value)
      case 'BooleanLiteral':
        return primary.value === 'true'
      case 'NilLiteral':
        return undefined
      case 'UnionLiteral':
        return new OOCUnion(
          primary.message.name,
          primary.message.args.map((row) => this.evaluatePrimary(row))
        )
      case 'IfMacro':
        return this.evaluateIfMacro(primary)
      case 'ReturnMacro':
        throw new ReturnValue(
          primary.value ? this.evaluateExpression(primary.value) : undefined
        )
      case 'WhileMacro':
        return this.evaluateWhileMacro(primary)
      default:
        return this.evaluateExpression(primary)
    }
  }

  interpret(model: OOCModel): OOCValue | undefined {
    const imports = model.beforeExpressions.filter((x) => x.$type == 'Import')
    //@todo imports批量导入
    try {
      for (const item of model.beforeExpressions) {
        if (item.$type != 'Import') {
          this.executeItem(item)
        }
      }
    } catch (error) {
      if (error instanceof ReturnValue) {
        return error.value
      }
    }
    return this.evaluateExpression(model.expression)
  }

  private executeItem(item: TopLevelItem): OOCValue {
    switch (item.$type) {
      case 'ExpressionCatch':
        try {
          const value = this.evaluateExpression(item.value)
          this.define(item.name, value)
        } catch (error) {
          if (error instanceof ReturnValue) {
            console.warn('不应该在这里出现')
          }
          this.define(item.error, error as any)
        }
        return
      case 'VarDeclaration':
        const value = this.evaluateExpression(item.value)
        this.define(item.name, value)
        return
      default:
        return this.evaluateExpression(item)
    }
  }

  evaluateExpression(expr: Expression): OOCValue {
    if (expr.$type == 'MessageOrChain') {
      const o = this.evaluatePrimary(expr.primary)
      if (expr.messages) {
        return this.willSendMessage(o, expr.messages)
      }
      return o
    }
    const result = this.evaluateExpression(expr.left)
    const right = expr.right

    switch (right.$type) {
      case 'Message':
        return this.willSendMessage(result, right)
      case 'MessageChain':
        const o = this.evaluatePrimary(right.primary)
        const name = right.messages.name
        const args = right.messages.args.map((v) => this.evaluatePrimary(v))
        args.unshift(result)
        return this.sendMessage(o, name, args)
      case 'PatternBinding':
        const env = new PatternBindingEnvironment(this, right.varName, result)
        return env.evaluateExpression(right.expr)
    }
  }
  private sendMessage(o: OOCValue, name: string, args: any[]): OOCValue {
    if (o instanceof OOCObject) {
      return o.sendMessage(name, args)
    }
    const tp = typeof o
    if (tp == 'undefined') {
      throw 'no method for nil'
    }
    if (tp == 'string') {
      const df = String.prototype[name as 'slice']
      if (df) {
        return df.apply(o, args as any)
      }
    }

    if (tp == 'number') {
    }
    if (tp == 'boolean') {
    }

    throw 'todo'
  }
  private willSendMessage(receiver: OOCValue, message: Message): OOCValue {
    const args = message.args.map((arg) => this.evaluatePrimary(arg))
    return this.sendMessage(receiver, message.name, args)
  }

  private evalExpressionBody(expressionBody: ExpressionBody) {
    for (let i = 0; i < expressionBody.beforeExpressions.length; i++) {
      const exp = expressionBody.beforeExpressions[i]
      this.executeItem(exp)
    }
    return this.evaluateExpression(expressionBody.expression)
  }

  private evaluateIfMacro(ifMacro: IfMacro): OOCValue {
    const condition = this.evaluateExpression(ifMacro.condition)
    if (condition) {
      return this.evalExpressionBody(ifMacro.thenBody)
    } else if (ifMacro.elseBody) {
      return this.evalExpressionBody(ifMacro.elseBody)
    }
    return undefined
  }

  private evaluateWhileMacro(whileMacro: WhileMacro): OOCValue {
    let out = undefined
    while (this.evaluateExpression(whileMacro.condition)) {
      out = this.evalExpressionBody(whileMacro.expression)
    }
    return out
  }
}

class PatternBindingEnvironment extends Environment {
  constructor(
    private parent: Environment,
    private name: string,
    private value: any
  ) {
    super()
  }
  get(name: string): OOCValue {
    if (name == this.name) {
      return this.value
    }
    return this.parent.get(name)
  }
  override define(name: string, value: OOCValue): void {
    throw new Error(`不能定义任何东西[${name}]`)
  }
}
/**
 * Environment for managing variable scopes
 */
class EnvironmentI extends Environment {
  private variables: Map<string, { value: OOCValue; asConst?: boolean }> =
    new Map()
  constructor(private parent: Environment | null = null) {
    super()
  }

  define(name: string, value: OOCValue, asConst?: boolean): void {
    if (this.variables.has(name)) {
      throw new Error(`此作用域中变量[${name}]已经定义`)
    }
    this.variables.set(name, { value, asConst })
  }

  get(name: string): OOCValue | undefined {
    const value = this.variables.get(name)
    if (value) {
      return value.value
    }
    if (this.parent) {
      return this.parent.get(name)
    }
    throw new Error(`在作用域链上无法找到[${name}]`)
  }
}
const globalEnv = new EnvironmentI()

export function executeOOC(model: OOCModel): any {
  return globalEnv.interpret(model)
}
