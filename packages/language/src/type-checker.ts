import type { AstNode, ValidationAcceptor } from 'langium'
import {
  isAssignment,
  isBool,
  isComplexPrimary,
  isImportStatement,
  isMessageChainExt,
  isMessageOrChain,
  isMessagePipRight,
  isMethodAll,
  isMethodBind,
  isNamedExpression,
  isNil,
  isNum,
  isObjectDef,
  isPiplingExpression,
  isProId,
  isRef,
  isStID,
  isStr,
  isTypeDef,
  type Assignment,
  type ComplexPrimary,
  type Expression,
  type Message,
  type Method,
  type MethodAll,
  type MethodDefName,
  type Model,
  type NamedExpression,
  type ObjectDef,
  type Param,
  type PiplingExpression,
  type Primary,
  type Type,
  type TypeDef,
  type TypeName,
} from './generated/ast.js'
import {
  anyType,
  booleanType,
  describeType,
  getBuiltinMethods,
  isSubtype,
  nilType,
  numberType,
  stringType,
  typeNameToString,
  unionOf,
  TypeEnv,
  type MethodSig,
  type ObjectTypeInfo,
  type TypeInfo,
} from './type-system.js'

const objectDesc = '对象'

/**
 * 静态类型检查器：类型只是装饰，全部以 warning 形式报告，不阻断执行。
 */
export class ObjectOrientedCTypeChecker {
  private readonly typedefs = new Map<string, TypeInfo>()

  checkModel(model: Model, accept: ValidationAcceptor): void {
    this.typedefs.clear()
    const env = new TypeEnv()
    for (const stmt of model.expressions) {
      this.checkTopStatement(stmt, env, accept)
    }
  }

  private checkTopStatement(
    stmt: Model['expressions'][number],
    env: TypeEnv,
    accept: ValidationAcceptor,
  ): void {
    if (isImportStatement(stmt)) {
      env.define(stmt.name, anyType)
      return
    }
    if (isTypeDef(stmt)) {
      this.checkTypeDef(stmt, env, accept)
      return
    }
    if (isAssignment(stmt)) {
      this.checkAssignment(stmt, env, accept)
      return
    }
    this.inferExpression(stmt, env, accept)
  }

  private checkTypeDef(
    stmt: TypeDef,
    env: TypeEnv,
    accept: ValidationAcceptor,
  ): void {
    if (this.typedefs.has(stmt.name)) {
      accept('warning', `类型 '${stmt.name}' 已经定义过了`, {
        node: stmt,
        property: 'name',
      })
    }
    // 先注册占位，支持自引用
    const placeholder: ObjectTypeInfo = { kind: 'object', methods: new Map() }
    this.typedefs.set(stmt.name, placeholder)
    env.define(stmt.name, placeholder)
    for (const member of stmt.body.members) {
      const name = this.getMethodName(member.name)
      const sigs = placeholder.methods.get(name) ?? []
      sigs.push({
        params: member.params.map((p) =>
          this.resolveParamAnnotation(p, accept),
        ),
        rest: undefined,
        returns: member.typeAnnotation
          ? this.resolveAnnotation(member.typeAnnotation, accept)
          : anyType,
      })
      placeholder.methods.set(name, sigs)
    }
    placeholder.name = stmt.name
  }

  private checkAssignment(
    stmt: Assignment,
    env: TypeEnv,
    accept: ValidationAcceptor,
  ): void {
    const objDef = this.unwrapObjectDef(stmt.expression)
    if (objDef) {
      // 提前注册名字，让方法体可以通过变量名自引用
      const t: ObjectTypeInfo = { kind: 'object', methods: new Map() }
      env.define(stmt.name, t)
      this.collectObject(objDef, env, accept, t.methods)
      this.checkObjectBody(objDef, env, t, accept)
      const declared = this.checkAnnotation(stmt.typeAnnotation, t, accept)
      env.define(stmt.name, declared)
      return
    }
    const inferred = this.inferExpression(stmt.expression, env, accept)
    const declared = this.checkAnnotation(stmt.typeAnnotation, inferred, accept)
    const prev = env.lookup(stmt.name)
    if (prev && prev.kind !== 'any' && declared.kind !== 'any') {
      if (!isSubtype(declared, prev)) {
        accept(
          'warning',
          `重新赋值类型不匹配：'${stmt.name}' 期望 ${describeType(prev)}，却得到了 ${describeType(declared)}`,
          { node: stmt, property: 'name' },
        )
      }
    }
    env.define(stmt.name, declared)
  }

  private checkAnnotation(
    annotation: Type | undefined,
    inferred: TypeInfo,
    accept: ValidationAcceptor,
  ): TypeInfo {
    if (!annotation) {
      return inferred
    }
    const expected = this.resolveAnnotation(annotation, accept)
    if (!isSubtype(inferred, expected)) {
      accept(
        'warning',
        `类型不匹配：期望 ${describeType(expected)}，却得到了 ${describeType(inferred)}`,
        { node: annotation, property: 'parts' },
      )
    }
    // 注解类型获胜：后续按声明类型检查
    return expected
  }

  private collectObject(
    objDef: ObjectDef,
    env: TypeEnv,
    accept: ValidationAcceptor,
    into: Map<string, MethodSig[]> = new Map(),
  ): ObjectTypeInfo {
    if (objDef.extends) {
      const parent = env.lookup(objDef.extends.value) ?? anyType
      if (parent.kind === 'object') {
        for (const [k, v] of parent.methods) {
          into.set(k, v)
        }
      }
    }
    const objType: ObjectTypeInfo = { kind: 'object', methods: into }
    for (const method of objDef.methods) {
      this.collectMethod(method, objType, accept)
    }
    return objType
  }

  private collectMethod(
    method: Method,
    objType: ObjectTypeInfo,
    accept: ValidationAcceptor,
  ): void {
    const name = this.getMethodName(method.name)
    const sigs = objType.methods.get(name) ?? []
    if (isMethodAll(method)) {
      sigs.push({
        params: method.params.map((p) =>
          this.resolveParamAnnotation(p, accept),
        ),
        rest: method.restParam
          ? (method.restParam.typeAnnotation
              ? this.resolveAnnotation(method.restParam.typeAnnotation, accept)
              : anyType)
          : undefined,
        returns: method.returnType
          ? this.resolveAnnotation(method.returnType, accept)
          : anyType,
      })
    } else {
      sigs.push({
        params: [],
        returns: method.typeAnnotation
          ? this.resolveAnnotation(method.typeAnnotation, accept)
          : anyType,
      })
    }
    objType.methods.set(name, sigs)
  }

  private checkObjectBody(
    objDef: ObjectDef,
    env: TypeEnv,
    objType: ObjectTypeInfo,
    accept: ValidationAcceptor,
  ): void {
    const bodyEnv = env.child()
    bodyEnv.define('this', objType)
    bodyEnv.define('currentObject', objType)
    bodyEnv.define('responser', anyType)
    const overloads: { method: MethodAll; returns: TypeInfo }[] = []
    for (const method of objDef.methods) {
      const name = this.getMethodName(method.name)
      if (isMethodBind(method)) {
        const inferred = this.inferExpression(method.expression, bodyEnv, accept)
        this.checkAnnotation(method.typeAnnotation, inferred, accept)
        const sigs = objType.methods.get(name)
        if (sigs && sigs.length > 0) {
          const last = sigs[sigs.length - 1]
          if (!method.typeAnnotation) {
            last.returns = inferred
          }
        }
        continue
      }
      const sig = this.checkMethod(method, bodyEnv, accept)
      overloads.push({ method, returns: sig.returns })
      const stored = objType.methods.get(name)
      if (stored && stored.length > 0) {
        const last = stored[stored.length - 1]
        if (!method.returnType) {
          last.returns = sig.returns
        }
      }
    }
    // 重载返回类型一致性（宽松检查）
    for (let i = 0; i < overloads.length; i++) {
      const a = overloads[i]
      if (a.returns.kind === 'any') {
        continue
      }
      for (let j = i + 1; j < overloads.length; j++) {
        const b = overloads[j]
        if (b.returns.kind === 'any') {
          continue
        }
        if (this.getMethodName(a.method.name) !== this.getMethodName(b.method.name)) {
          continue
        }
        if (
          !isSubtype(a.returns, b.returns) ||
          !isSubtype(b.returns, a.returns)
        ) {
          accept(
            'warning',
            `方法 '${this.getMethodName(a.method.name)}' 的重载返回类型不一致：${describeType(a.returns)} 与 ${describeType(b.returns)}`,
            { node: b.method, property: 'name' },
          )
        }
      }
    }
  }

  private checkMethod(
    method: MethodAll,
    env: TypeEnv,
    accept: ValidationAcceptor,
  ): MethodSig {
    const methodEnv = env.child()
    const params = method.params.map((p) => this.bindParam(p, methodEnv, accept))
    const rest = this.bindParam(method.restParam, methodEnv, accept)
    const declaredReturn = method.returnType
      ? this.resolveAnnotation(method.returnType, accept)
      : anyType
    if (method.guardExpression) {
      const guardType = this.inferExpression(
        method.guardExpression,
        methodEnv,
        accept,
      )
      if (
        guardType.kind === 'name' &&
        guardType.name !== 'boolean' &&
        guardType.name !== 'nil'
      ) {
        accept(
          'warning',
          `#guard 条件应该是布尔值，却得到了 ${describeType(guardType)}`,
          { node: method.guardExpression },
        )
      }
    }
    let returnType: TypeInfo = nilType
    for (const stmt of method.expressions) {
      if (isAssignment(stmt)) {
        this.checkAssignment(stmt, methodEnv, accept)
      } else {
        returnType = this.inferExpression(stmt, methodEnv, accept)
      }
    }
    if (method.returnType) {
      this.checkAnnotation(method.returnType, returnType, accept)
    }
    return { params, rest, returns: method.returnType ? declaredReturn : returnType }
  }

  private bindParam(
    param: Param | undefined,
    env: TypeEnv,
    accept: ValidationAcceptor,
  ): TypeInfo | undefined {
    if (!param) {
      return undefined
    }
    const t = param.typeAnnotation
      ? this.resolveAnnotation(param.typeAnnotation, accept)
      : anyType
    env.define(param.name, t)
    return t
  }

  private resolveParamAnnotation(
    param: Param | undefined,
    accept: ValidationAcceptor,
  ): TypeInfo | undefined {
    if (!param) {
      return undefined
    }
    if (!param.typeAnnotation) {
      return anyType
    }
    return this.resolveAnnotation(param.typeAnnotation, accept)
  }

  private resolveAnnotation(type: Type, accept: ValidationAcceptor): TypeInfo {
    const resolved = type.parts.map((part) =>
      this.resolveTypeName(part, accept),
    )
    return unionOf(resolved)
  }

  private resolveTypeName(part: TypeName, accept: ValidationAcceptor): TypeInfo {
    const name = typeNameToString(part)
    switch (name) {
      case 'any':
        return anyType
      case 'number':
        return numberType
      case 'string':
        return stringType
      case 'boolean':
        return booleanType
      case 'nil':
        return nilType
      case 'true':
      case 'false':
        return booleanType
    }
    const named = this.typedefs.get(name)
    if (named) {
      return named
    }
    accept('warning', `未知类型 '${name}'`, {
      node: part,
      property: 'name',
    })
    return anyType
  }

  private inferExpression(
    e: Expression,
    env: TypeEnv,
    accept: ValidationAcceptor,
  ): TypeInfo {
    if (isPiplingExpression(e)) {
      let t = this.inferExpression(e.left, env, accept)
      t = this.inferRight(t, e.right, env, accept)
      return t
    }
    const t = this.inferPrimary(e.primary, env, accept)
    if (e.message) {
      return this.inferMessage(t, e.message, env, accept)
    }
    return t
  }

  private inferRight(
    left: TypeInfo,
    right: PiplingExpression['right'],
    env: TypeEnv,
    accept: ValidationAcceptor,
  ): TypeInfo {
    if (isMessageChainExt(right)) {
      return this.inferMessage(left, right.value, env, accept)
    }
    if (isMessagePipRight(right)) {
      const value = right.value
      if (isNamedExpression(value)) {
        // 管道 lambda：x | p => expr
        const pipeEnv = env.child()
        const paramType = value.typeAnnotation
          ? this.resolveAnnotation(value.typeAnnotation, accept)
          : left
        if (value.typeAnnotation && !isSubtype(left, paramType)) {
          accept(
            'warning',
            `管道参数类型不匹配：期望 ${describeType(paramType)}，却得到了 ${describeType(left)}`,
            { node: value.typeAnnotation, property: 'parts' },
          )
        }
        pipeEnv.define(value.param, paramType)
        return this.inferNamedExpressionBody(value, pipeEnv, accept)
      }
      // 管道调用：x | main args 等价于 main 的 (x, ...args)
      const argTypes = [left]
      for (const arg of value.message.args) {
        argTypes.push(this.inferPrimary(arg, env, accept))
      }
      const mainType = this.inferPrimary(value.primary, env, accept)
      return this.dispatch(
        mainType,
        this.getMessageName(value.message),
        argTypes,
        accept,
        value.message,
      )
    }
    // 中缀
    const rightType = this.inferPrimary(right.value, env, accept)
    return this.inferInfix(left, right.infix, rightType)
  }

  private inferNamedExpressionBody(
    value: NamedExpression,
    env: TypeEnv,
    accept: ValidationAcceptor,
  ): TypeInfo {
    return this.inferExpression(value.expression, env, accept)
  }

  private inferInfix(
    left: TypeInfo,
    infix: string,
    right: TypeInfo,
  ): TypeInfo {
    if (infix === '&&' || infix === '||') {
      return unionOf([left, right])
    }
    if (
      infix === '>' ||
      infix === '<' ||
      infix === '>=' ||
      infix === '<=' ||
      infix === '==' ||
      infix === '!='
    ) {
      return booleanType
    }
    if (
      left.kind === 'name' &&
      left.name === 'number' &&
      right.kind === 'name' &&
      right.name === 'number'
    ) {
      return numberType
    }
    if (
      infix === '+' &&
      left.kind === 'name' &&
      right.kind === 'name' &&
      (left.name === 'string' || right.name === 'string')
    ) {
      return stringType
    }
    return anyType
  }

  private inferMessage(
    receiver: TypeInfo,
    message: Message,
    env: TypeEnv,
    accept: ValidationAcceptor,
  ): TypeInfo {
    const argTypes = message.args.map((arg) =>
      this.inferPrimary(arg, env, accept),
    )
    return this.dispatch(
      receiver,
      this.getMessageName(message),
      argTypes,
      accept,
      message,
    )
  }

  private dispatch(
    receiver: TypeInfo,
    name: string,
    args: TypeInfo[],
    accept: ValidationAcceptor,
    node: AstNode,
  ): TypeInfo {
    switch (receiver.kind) {
      case 'any':
        return anyType
      case 'union': {
        const results = receiver.types.map((sub) =>
          this.dispatch(sub, name, args, accept, node),
        )
        if (results.some((r) => r.kind === 'any')) {
          return anyType
        }
        return unionOf(results)
      }
      case 'name': {
        const sigs = getBuiltinMethods(receiver.name).get(name)
        if (!sigs) {
          return anyType
        }
        return this.checkArgs(
          sigs,
          name,
          args,
          accept,
          node,
          `类型 ${receiver.name}`,
        )
      }
      case 'object': {
        const sigs = receiver.methods.get(name)
        if (!sigs) {
          return anyType
        }
        return this.checkArgs(
          sigs,
          name,
          args,
          accept,
          node,
          receiver.name ? `对象类型 ${receiver.name}` : objectDesc,
        )
      }
      default:
        return anyType
    }
  }

  private checkArgs(
    sigs: MethodSig[],
    name: string,
    args: TypeInfo[],
    accept: ValidationAcceptor,
    node: AstNode,
    receiverDesc: string,
  ): TypeInfo {
    for (const sig of sigs) {
      if (this.argsCompatible(sig, args)) {
        return sig.returns
      }
    }
    const expected = sigs
      .map((s) => {
        const params = s.params.map((p) => describeType(p ?? anyType))
        return `${name}(${params.join(', ')})`
      })
      .join(' 或 ')
    accept(
      'warning',
      `调用参数不匹配：${receiverDesc} 期望 ${expected}，实际参数类型为 ${args.map(describeType).join(', ')}`,
      { node },
    )
    return sigs[0]?.returns ?? anyType
  }

  private argsCompatible(sig: MethodSig, args: TypeInfo[]): boolean {
    const { params, rest } = sig
    if (rest) {
      if (args.length < params.length) {
        return false
      }
      for (let i = 0; i < params.length; i++) {
        if (!this.argOk(args[i], params[i])) {
          return false
        }
      }
      const restArgs = args.slice(params.length)
      if (restArgs.length > 0 && !restArgs.every((a) => this.argOk(a, rest))) {
        return false
      }
      return true
    }
    if (args.length > params.length) {
      return false
    }
    for (let i = 0; i < args.length; i++) {
      if (!this.argOk(args[i], params[i])) {
        return false
      }
    }
    return true
  }

  private argOk(arg: TypeInfo, param: TypeInfo | undefined): boolean {
    if (!param || param.kind === 'any' || arg.kind === 'any') {
      return true
    }
    return isSubtype(arg, param)
  }

  private inferComplexPrimary(
    e: ComplexPrimary,
    env: TypeEnv,
    accept: ValidationAcceptor,
  ): TypeInfo {
    if (isObjectDef(e)) {
      const t: TypeInfo = { kind: 'object', methods: new Map() }
      this.collectObject(e, env, accept, t.methods)
      this.checkObjectBody(e, env, t, accept)
      return t
    }
    return this.inferExpression(e, env, accept)
  }

  private inferPrimary(
    p: Primary,
    env: TypeEnv,
    accept: ValidationAcceptor,
  ): TypeInfo {
    if (isBool(p)) {
      return booleanType
    }
    if (isNil(p)) {
      return nilType
    }
    if (isNum(p)) {
      return numberType
    }
    if (isRef(p)) {
      return env.lookup(p.value) ?? anyType
    }
    if (isStr(p) || isStID(p)) {
      return stringType
    }
    if (isComplexPrimary(p)) {
      return this.inferComplexPrimary(p, env, accept)
    }
    return anyType
  }

  private unwrapObjectDef(expr: Expression): ObjectDef | undefined {
    if (!isMessageOrChain(expr) || expr.message) {
      return undefined
    }
    return this.unwrapPrimary(expr.primary)
  }

  private unwrapPrimary(p: Primary): ObjectDef | undefined {
    if (isObjectDef(p)) {
      return p
    }
    if (isComplexPrimary(p)) {
      if (isObjectDef(p)) {
        return p
      }
      if (isPiplingExpression(p) || isMessageOrChain(p)) {
        return this.unwrapObjectDef(p)
      }
    }
    return undefined
  }

  private getMethodName(name: MethodDefName): string {
    const v = name.name
    if (isRef(v)) {
      return v.value
    }
    if (isStID(v)) {
      return v.value.slice(1)
    }
    return v.value
  }

  private getMessageName(m: Message): string {
    const v = m.name.value
    if (isProId(v)) {
      return v.value.slice(1)
    }
    if (isRef(v)) {
      return v.value
    }
    if (isStID(v)) {
      return v.value.slice(1)
    }
    return v.value
  }
}
