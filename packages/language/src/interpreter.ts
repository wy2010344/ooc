/**
 * OOC Language Interpreter
 *
 * Executes OOC AST nodes based on the new grammar (Langium 4.1)
 * Supports: message passing, pipelines, closures, objects, and macros
 */

import type {
  OOCModel,
  Item,
  VarDeclaration,
  Statement,
  Pipeline,
  MessageChain,
  Message,
  Primary,
  ObjectLiteral,
  MethodMember,
  VariableMember,
  CachedMember,
  StringLiteral,
  NumberLiteral,
  BooleanLiteral,
  UnionLiteral,
  IfMacro,
  WhileMacro,
  ReturnMacro,
} from './generated/ast.js'

export interface OOCValue {
  $type:
    | 'object'
    | 'string'
    | 'number'
    | 'boolean'
    | 'nil'
    | 'union'
    | 'function'
  value?: any
  methods?: Map<string, OOCFunction>
}

export interface OOCFunction {
  paramNames: string[]
  body?: any
  closure: Environment
  isAsync?: boolean
  isCached?: boolean
  cachedValue?: any
}

/**
 * Environment for managing variable scopes
 */
class Environment {
  private variables: Map<string, OOCValue> = new Map()
  private parent: Environment | null

  constructor(parent: Environment | null = null) {
    this.parent = parent
  }

  define(name: string, value: OOCValue): void {
    this.variables.set(name, value)
  }

  get(name: string): OOCValue | undefined {
    if (this.variables.has(name)) {
      return this.variables.get(name)
    }
    if (this.parent) {
      return this.parent.get(name)
    }
    return undefined
  }

  set(name: string, value: OOCValue): void {
    if (this.variables.has(name)) {
      this.variables.set(name, value)
      return
    }
    if (this.parent) {
      this.parent.set(name, value)
      return
    }
    // Define in current scope if not found
    this.variables.set(name, value)
  }

  child(): Environment {
    return new Environment(this)
  }
}

/**
 * Main OOC Interpreter
 */
export class OOCInterpreter {
  private globalEnv: Environment
  private currentEnv: Environment
  private returnValue: OOCValue | null = null
  private shouldReturn = false

  constructor() {
    this.globalEnv = new Environment()
    this.currentEnv = this.globalEnv
  }

  interpret(model: OOCModel): OOCValue | undefined {
    console.log('OOC Interpreter initialized')
    let lastValue: OOCValue | undefined = undefined

    for (const item of model.items) {
      console.log('executeItem', (item as any)?.$type)
      const result = this.executeItem(item)
      console.log('executeItem result:', result?.$type)
      if (result !== undefined) {
        lastValue = result
      }
    }

    console.log('Final lastValue:', lastValue?.$type)
    return lastValue
  }

  private executeItem(item: Item): OOCValue | undefined {
    if (item.$type === 'VarDeclaration') {
      const varDecl = item as VarDeclaration
      const value = this.evaluatePipeline(varDecl.value)
      this.currentEnv.define(varDecl.name, value)
      return value
    } else if (item.$type === 'Statement') {
      const stmt = item as Statement
      return this.evaluatePipeline(stmt.expression)
    }
    // Skip Export and Import for now
    return undefined
  }

  private evaluatePipeline(pipeline: Pipeline): OOCValue {
    let result = this.evaluateMessageChain(pipeline.messageChain)
    // TODO: Process pipeline operations (/ and | operators)
    return result
  }

  private evaluateMessageChain(chain: MessageChain): OOCValue {
    // Evaluate primary first
    let result = this.evaluatePrimary(chain.primary)

    // Then evaluate optional message
    if (chain.messages) {
      result = this.sendMessage(result, chain.messages)
    }

    return result
  }

  private evaluatePrimary(primary: Primary | string): OOCValue {
    if (!primary) {
      return { $type: 'nil' }
    }

    // Handle string primary (ID reference)
    if (typeof primary === 'string') {
      const value = this.currentEnv.get(primary)
      return value || { $type: 'nil' }
    }

    const primType = (primary as any)?.$type

    switch (primType) {
      case 'ObjectLiteral':
        return this.evaluateObjectLiteral(primary as unknown as ObjectLiteral)
      case 'StringLiteral':
        return {
          $type: 'string',
          value: (primary as unknown as StringLiteral).value.slice(1, -1),
        }
      case 'NumberLiteral':
        return {
          $type: 'number',
          value: parseFloat((primary as unknown as NumberLiteral).value),
        }
      case 'BooleanLiteral':
        return {
          $type: 'boolean',
          value: (primary as unknown as BooleanLiteral).value === 'true',
        }
      case 'NilLiteral':
        return { $type: 'nil' }
      case 'UnionLiteral':
        return this.evaluateUnionLiteral(primary as unknown as UnionLiteral)
    }

    return { $type: 'nil' }
  }

  private evaluateObjectLiteral(obj: ObjectLiteral): OOCValue {
    const methods = new Map<string, OOCFunction>()
    const variables = new Map<string, OOCValue>()

    // Create closure environment for this object
    const closure = this.currentEnv.child()

    for (const member of obj.members) {
      if (member.$type === 'MethodMember') {
        const methodMember = member as MethodMember
        const paramNames = methodMember.params?.params || []
        methods.set(methodMember.name, {
          paramNames,
          body: methodMember.body?.expression || methodMember.body?.expressions,
          closure,
        })
      } else if (member.$type === 'VariableMember') {
        const varMember = member as VariableMember
        const value = this.evaluatePipeline(varMember.value)
        variables.set(varMember.name, value)
        closure.define(varMember.name, value)
      } else if (member.$type === 'CachedMember') {
        const cachedMember = member as CachedMember
        const value = this.evaluatePipeline(cachedMember.value)
        methods.set(cachedMember.name, {
          paramNames: [],
          body: undefined,
          closure,
          isCached: true,
          cachedValue: value,
        })
      }
    }

    return {
      $type: 'object',
      value: variables,
      methods,
    }
  }

  private sendMessage(receiver: OOCValue, message: Message): OOCValue {
    const messageName = message.name
    const args = (message.args || []).map((arg) => this.evaluatePrimary(arg))

    // Handle built-in methods
    if (receiver.$type === 'string') {
      return this.handleStringMessage(receiver.value, messageName, args)
    } else if (receiver.$type === 'number') {
      return this.handleNumberMessage(receiver.value, messageName, args)
    } else if (receiver.$type === 'boolean') {
      return this.handleBooleanMessage(receiver.value, messageName, args)
    } else if (receiver.$type === 'object' && receiver.methods) {
      const method = receiver.methods.get(messageName)
      if (method) {
        return this.executeMethod(
          method,
          args,
          receiver.value as Map<string, OOCValue>
        )
      }
    }

    return { $type: 'nil' }
  }

  private handleStringMessage(
    str: string,
    messageName: string,
    args: OOCValue[]
  ): OOCValue {
    switch (messageName) {
      case 'length':
        return { $type: 'number', value: str.length }
      case 'add':
        if (args.length > 0) {
          const other = this.valueToString(args[0])
          return { $type: 'string', value: str + other }
        }
        return { $type: 'string', value: str }
      default:
        return { $type: 'nil' }
    }
  }

  private handleNumberMessage(
    num: number,
    messageName: string,
    args: OOCValue[]
  ): OOCValue {
    switch (messageName) {
      case 'add':
        if (args.length > 0) {
          const other = this.valueToNumber(args[0])
          return { $type: 'number', value: num + other }
        }
        return { $type: 'number', value: num }
      case 'sub':
        if (args.length > 0) {
          const other = this.valueToNumber(args[0])
          return { $type: 'number', value: num - other }
        }
        return { $type: 'number', value: num }
      case 'mul':
        if (args.length > 0) {
          const other = this.valueToNumber(args[0])
          return { $type: 'number', value: num * other }
        }
        return { $type: 'number', value: num }
      case 'div':
        if (args.length > 0) {
          const other = this.valueToNumber(args[0])
          if (other !== 0) {
            return { $type: 'number', value: num / other }
          }
        }
        return { $type: 'nil' }
      default:
        return { $type: 'nil' }
    }
  }

  private handleBooleanMessage(
    _bool: boolean,
    _messageName: string,
    _args: OOCValue[]
  ): OOCValue {
    // Add boolean-specific methods as needed
    return { $type: 'nil' }
  }

  private executeMethod(
    method: OOCFunction,
    args: OOCValue[],
    objectVars?: Map<string, OOCValue>
  ): OOCValue {
    // Handle cached members
    if (method.isCached) {
      return method.cachedValue || { $type: 'nil' }
    }

    // Create new environment for method execution
    const methodEnv = method.closure.child()

    // Bind parameters
    for (let i = 0; i < method.paramNames.length; i++) {
      methodEnv.define(method.paramNames[i], args[i] || { $type: 'nil' })
    }

    // Make object variables accessible in method
    if (objectVars) {
      for (const [key, value] of objectVars.entries()) {
        methodEnv.define(key, value)
      }
    }

    // Execute method body
    const prevEnv = this.currentEnv
    this.currentEnv = methodEnv
    this.shouldReturn = false
    this.returnValue = null

    let result: OOCValue = { $type: 'nil' }

    if (Array.isArray(method.body)) {
      // Multiple expressions
      for (const expr of method.body) {
        result = this.evaluatePipeline(expr)
        if (this.shouldReturn) {
          result = this.returnValue || { $type: 'nil' }
          this.shouldReturn = false
          break
        }
      }
    } else if (method.body) {
      // Single expression
      result = this.evaluatePipeline(method.body)
    }

    this.currentEnv = prevEnv
    return result
  }

  private evaluateUnionLiteral(union: UnionLiteral): OOCValue {
    const args = (union.unionArgs || []).map((arg) => {
      if (typeof arg === 'string') {
        if (arg.startsWith("'")) {
          return { $type: 'string', value: arg.slice(1, -1) }
        } else {
          const num = parseFloat(arg)
          if (!isNaN(num)) {
            return { $type: 'number', value: num }
          }
          return { $type: 'string', value: arg }
        }
      }
      return { $type: 'nil' }
    })

    return {
      $type: 'union',
      value: {
        constructor: union.constructor,
        args,
      },
    }
  }

  private evaluateIfMacro(ifMacro: IfMacro): OOCValue {
    const condition = this.evaluatePipeline(ifMacro.condition)
    const isTruthy = this.isTruthy(condition)

    if (isTruthy) {
      if (Array.isArray(ifMacro.thenBody)) {
        let result: OOCValue = { $type: 'nil' }
        for (const expr of ifMacro.thenBody) {
          result = this.evaluatePipeline(expr)
        }
        return result
      } else {
        return this.evaluatePipeline(ifMacro.thenBody as any)
      }
    } else if (ifMacro.elseBody) {
      if (Array.isArray(ifMacro.elseBody)) {
        let result: OOCValue = { $type: 'nil' }
        for (const expr of ifMacro.elseBody) {
          result = this.evaluatePipeline(expr)
        }
        return result
      } else {
        return this.evaluatePipeline(ifMacro.elseBody as any)
      }
    }

    return { $type: 'nil' }
  }

  private evaluateWhileMacro(whileMacro: WhileMacro): OOCValue {
    let result: OOCValue = { $type: 'nil' }

    while (this.isTruthy(this.evaluatePipeline(whileMacro.condition))) {
      for (const expr of whileMacro.body) {
        result = this.evaluatePipeline(expr)
      }
    }

    return result
  }

  private evaluateReturnMacro(returnMacro: ReturnMacro): OOCValue {
    const value = returnMacro.value
      ? this.evaluatePipeline(returnMacro.value)
      : { $type: 'nil' }
    this.shouldReturn = true
    this.returnValue = value
    return value
  }

  private isTruthy(value: OOCValue): boolean {
    if (value.$type === 'nil') return false
    if (value.$type === 'boolean') return value.value === true
    if (value.$type === 'number') return value.value !== 0
    if (value.$type === 'string') return value.value !== ''
    return true
  }

  private valueToString(value: OOCValue): string {
    switch (value.$type) {
      case 'string':
        return value.value || ''
      case 'number':
        return String(value.value || 0)
      case 'boolean':
        return String(value.value || false)
      case 'nil':
        return 'nil'
      case 'union':
        return JSON.stringify(value.value)
      default:
        return '[object]'
    }
  }

  private valueToNumber(value: OOCValue): number {
    switch (value.$type) {
      case 'number':
        return value.value || 0
      case 'string':
        return parseFloat(value.value || '0') || 0
      case 'boolean':
        return value.value ? 1 : 0
      default:
        return 0
    }
  }
}

export function executeOOC(model: OOCModel): any {
  const interpreter = new OOCInterpreter()
  const result = interpreter.interpret(model)
  // Return the value of the last expression/statement
  if (result) {
    if (result.$type === 'object') {
      // For objects, return an object representation
      return { ...result.value }
    } else if (result.$type === 'union') {
      return result.value
    } else {
      return result.value !== undefined ? result.value : true
    }
  }
  return true // Return true if successful
}
