/**
 * OOC Language JavaScript Interpreter
 *
 * This interpreter executes OOC AST nodes in JavaScript, supporting:
 * - Object literal evaluation and method calls
 * - Message passing between objects
 * - Variable declarations and references
 * - Basic type operations
 * - Pipe operations for method chaining
 */

import type {
  OOCModel,
  Expr,
  Base,
  Primary,
  StringLit,
  NumLit,
  BoolLit,
  ObjLit,
  UnionVal,
  VarDecl,
  Import,
  Export,
  Item,
  MethodDecl,
} from './generated/ast.js'

export interface OOCValue {
  $type: 'object' | 'string' | 'number' | 'boolean' | 'union'
  value: any
  methods?: Record<string, OOCMethod>
}

export interface OOCMethod {
  params: string[]
  body: (args: any[]) => any
  isAsync?: boolean
}

export class OOCInterpreter {
  private globalScope: Record<string, any> = {}
  private scopes: Record<string, any>[] = [this.globalScope]

  constructor() {
    this.initBuiltins()
  }

  /**
   * Execute a complete OOC model
   */
  public execute(model: OOCModel): any {
    const results: any[] = []

    // Debug: show item types to help trace missing handling
    // console.log(
    //   'Executing model items:',
    //   model.items.map((i) => i.$type)
    // )

    for (const item of model.items) {
      const result = this.executeItem(item)
      results.push(result)
    }

    return results.length === 1 ? results[0] : results
  }

  private initBuiltins(): void {
    // gcd: computes greatest common divisor of two numbers
    this.globalScope['gcd'] = (obj: any, other: any) => {
      const a = this.toJSValue(obj)
      const b = this.toJSValue(other)
      const toInt = (v: any) => Math.floor(Number(v))
      let x = Math.abs(toInt(a))
      let y = Math.abs(toInt(b))
      while (y !== 0) {
        const t = x % y
        x = y
        y = t
      }
      return { $type: 'number', value: x }
    }

    // factorial: compute factorial of a non-negative integer
    this.globalScope['factorial'] = (obj: any) => {
      const n = Math.floor(Number(this.toJSValue(obj)))
      if (n <= 1) return { $type: 'number', value: 1 }
      let acc = 1
      for (let i = 2; i <= n; i++) acc *= i
      return { $type: 'number', value: acc }
    }

    // sumList: expects a linked list encoded as union $cons head tail | $nil
    this.globalScope['sumList'] = (obj: any) => {
      let cur = obj
      let total = 0
      while (cur && cur.$type === 'union' && cur.value) {
        if (cur.value.tag === 'cons') {
          const head = cur.value.args && cur.value.args[0]
          total += Number(this.toJSValue(head))
          cur = cur.value.args && cur.value.args[1]
        } else {
          break
        }
      }
      return { $type: 'number', value: total }
    }
  }

  /**
   * Execute a single item (import, export, or statement)
   */
  private executeItem(item: Item): any {
    if (item.$type === 'Import') {
      return this.executeImport(item as Import)
    } else if (item.$type === 'Export') {
      return this.executeExport(item as Export)
    } else if (item.$type === 'Statement') {
      return this.executeExpr((item as any).expr)
    } else if (item.$type === 'VarDecl') {
      return this.executeVarDecl(item as VarDecl)
    } else if (item.$type === 'MethodDecl') {
      return this.executeMethodDecl(item as MethodDecl)
    }

    return undefined
  }

  /**
   * Execute import statement
   */
  private executeImport(imp: Import): any {
    // In a real implementation, this would load a module
    // For now, we'll just store it
    console.log(`Importing ${imp.name} from ${imp.filepath}`)
    return undefined
  }

  /**
   * Execute export statement
   */
  private executeExport(exp: Export): any {
    if (exp.decl.$type === 'VarDecl') {
      return this.executeVarDecl(exp.decl as VarDecl)
    } else if (exp.decl.$type === 'MethodDecl') {
      return this.executeMethodDecl(exp.decl as MethodDecl)
    }
    return undefined
  }

  /**
   * Execute variable declaration
   */
  private executeVarDecl(decl: VarDecl): any {
    const value = this.executeExpr(decl.value)
    this.setVariable(decl.name, value)
    return value
  }

  /**
   * Execute method declaration at module level
   */
  private executeMethodDecl(decl: MethodDecl): any {
    const method: OOCMethod = {
      params: decl.params?.params ?? [],
      body: (args: any[]) => {
        // Create new scope with parameters
        const paramScope: Record<string, any> = {}
        const params = decl.params?.params ?? []
        for (let i = 0; i < params.length; i++) {
          paramScope[params[i]] = args[i]
        }

        this.scopes.push(paramScope)
        try {
          return this.executeExpr(decl.body)
        } finally {
          this.scopes.pop()
        }
      },
      isAsync: false,
    }

    this.setVariable(decl.name, method)
    return method
  }

  /**
   * Execute expression
   */
  private executeExpr(expr: Expr): any {
    if (expr.$type === 'Base') {
      return this.executeBase(expr as Base)
    }
    return undefined
  }

  /**
   * Execute base expression (atom + method calls)
   */
  private executeBase(base: Base): any {
    let result = this.executePrimary(base.atom)

    // Execute method calls in sequence
    for (const methodCall of base.methods) {
      result = this.executeMethodCall(result, methodCall)
    }

    return result
  }

  /**
   * Execute primary expression
   */
  private executePrimary(primary: Primary): any {
    if (!primary) return undefined

    // Handle literals
    if (primary.$type === 'StringLit') {
      return this.executeStringLit(primary as StringLit)
    } else if (primary.$type === 'NumLit') {
      return this.executeNumLit(primary as NumLit)
    } else if (primary.$type === 'BoolLit') {
      return this.executeBoolLit(primary as BoolLit)
    } else if (primary.$type === 'ObjLit') {
      return this.executeObjLit(primary as ObjLit)
    } else if (primary.$type === 'UnionVal') {
      return this.executeUnionVal(primary as UnionVal)
    } else if (primary.$type === 'Base') {
      // It's a nested expression in parentheses
      return this.executeBase(primary as Base)
    } else if (typeof primary === 'string') {
      // It's an identifier
      return this.getVariable(primary)
    }
    return undefined
  }

  /**
   * Execute string literal
   */
  private executeStringLit(lit: StringLit): OOCValue {
    return {
      $type: 'string',
      value: lit.value,
      methods: {
        length: {
          params: [],
          body: () => ({
            $type: 'number',
            value: lit.value.length,
          }),
        },
        slice: {
          params: ['start', 'end'],
          body: (args: any[]) => ({
            $type: 'string',
            value: lit.value.slice(args[0], args[1]),
          }),
        },
        add: {
          params: ['other'],
          body: (args: any[]) => ({
            $type: 'string',
            value: lit.value + this.toJSValue(args[0]),
          }),
        },
      },
    }
  }

  /**
   * Execute number literal
   */
  private executeNumLit(lit: NumLit): OOCValue {
    const num =
      typeof lit.value === 'string' ? parseFloat(lit.value) : lit.value
    return {
      $type: 'number',
      value: num,
      methods: {
        add: {
          params: ['other'],
          body: (args: any[]) => ({
            $type: 'number',
            value: num + this.toJSValue(args[0]),
          }),
        },
        sub: {
          params: ['other'],
          body: (args: any[]) => ({
            $type: 'number',
            value: num - this.toJSValue(args[0]),
          }),
        },
        mul: {
          params: ['other'],
          body: (args: any[]) => ({
            $type: 'number',
            value: num * this.toJSValue(args[0]),
          }),
        },
        div: {
          params: ['other'],
          body: (args: any[]) => ({
            $type: 'number',
            value: num / this.toJSValue(args[0]),
          }),
        },
      },
    }
  }

  /**
   * Execute boolean literal
   */
  private executeBoolLit(lit: BoolLit): OOCValue {
    return {
      $type: 'boolean',
      value: lit.value === 'true',
      methods: {
        and: {
          params: ['other'],
          body: (args: any[]) => ({
            $type: 'boolean',
            value: lit.value === 'true' && this.toJSValue(args[0]),
          }),
        },
        or: {
          params: ['other'],
          body: (args: any[]) => ({
            $type: 'boolean',
            value: lit.value === 'true' || this.toJSValue(args[0]),
          }),
        },
        not: {
          params: [],
          body: () => ({
            $type: 'boolean',
            value: lit.value !== 'true',
          }),
        },
      },
    }
  }

  /**
   * Execute object literal
   */
  private executeObjLit(lit: ObjLit): OOCValue {
    const obj: any = { $type: 'object' }
    const methods: Record<string, OOCMethod> = {}
    const properties: Record<string, any> = {}

    for (const item of lit.items) {
      // Check if it's a method (has params or expr)
      if (item.params !== undefined || item.expr !== undefined) {
        // It's a method
        const params = item.params?.params ?? []
        methods[item.name] = {
          params,
          body: (args: any[]) => {
            // Create new scope for method execution
            const methodScope: Record<string, any> = {}
            for (let i = 0; i < params.length; i++) {
              methodScope[params[i]] = args[i]
            }
            // Add this object's properties to scope
            for (const [k, v] of Object.entries(properties)) {
              methodScope[k] = v
            }

            this.scopes.push(methodScope)
            try {
              return item.expr ? this.executeExpr(item.expr) : undefined
            } finally {
              this.scopes.pop()
            }
          },
        }
      } else if (item.val !== undefined) {
        // It's a property
        const value = this.executeExpr(item.val)
        properties[item.name] = value
      } else {
        // Simple reference to variable
        try {
          properties[item.name] = this.getVariable(item.name)
        } catch {
          // Variable not found, skip
        }
      }
    }

    // Combine properties and methods
    for (const [k, v] of Object.entries(properties)) {
      obj[k] = v
    }
    obj.methods = methods
    obj.value = properties

    return obj
  }

  /**
   * Execute union value (tagged union)
   */
  private executeUnionVal(union: UnionVal): OOCValue {
    const args = union.args ? this.executeArgs(union.args) : []
    return {
      $type: 'union',
      value: {
        tag: union.tag,
        args,
      },
    }
  }

  /**
   * Execute arguments
   */
  private executeArgs(args: any): any[] {
    return args.items.map((item: any) => this.executePrimary(item))
  }

  /**
   * Execute method call on an object
   */
  private executeMethodCall(obj: any, call: any): any {
    const args = call.args ? this.executeArgs(call.args) : []

    // Check if it's a method on the object
    if (obj && obj.methods && obj.methods[call.name]) {
      const method = obj.methods[call.name]
      return method.body(args)
    }

    // Try to find it in current scope as a function (including built-ins)
    let func: any
    try {
      func = this.getVariable(call.name)
    } catch {
      // Function not found; skip
      func = undefined
    }

    if (func) {
      if (func instanceof Function) {
        // Regular JS function (built-in)
        return func(obj, ...args.map((a) => this.toJSValue(a)))
      } else if (func.body instanceof Function) {
        // OOC method object with body function
        return func.body([obj, ...args])
      } else if (typeof func === 'function') {
        // Wrapped function
        return func(obj, ...args)
      }
    }

    // No method found
    throw new Error(`Unknown method or function: ${call.name}`)
  }

  /**
   * Convert OOC value to JavaScript value
   */
  private toJSValue(value: any): any {
    if (value && typeof value === 'object') {
      if (value.$type === 'number') return value.value
      if (value.$type === 'string') return value.value
      if (value.$type === 'boolean') return value.value
      if (value.$type === 'union') return value.value
      if (value.$type === 'object') return value
    }
    return value
  }

  /**
   * Set variable in current scope
   */
  private setVariable(name: string, value: any): void {
    const currentScope = this.scopes[this.scopes.length - 1]
    currentScope[name] = value
  }

  /**
   * Get variable from scope chain
   */
  private getVariable(name: string): any {
    for (let i = this.scopes.length - 1; i >= 0; i--) {
      if (name in this.scopes[i]) {
        return this.scopes[i][name]
      }
    }
    throw new Error(`Undefined variable: ${name}`)
  }
}

/**
 * Execute OOC code from AST
 */
export function executeOOC(model: OOCModel): any {
  const interpreter = new OOCInterpreter()
  return interpreter.execute(model)
}
