import type { AstNode, LangiumDocuments, ValidationAcceptor } from 'langium'
import { AstUtils, URI } from 'langium'
import { diagnosticData } from './diagnostics-config.js'
import {
  isAssignment,
  isBool,
  isComplexPrimary,
  isImportStatement,
  isLambdaDef,
  isMessageChainExt,
  isMessageInfixRight,
  isMessageOrChain,
  isMessagePipRight,
  isMethodAll,
  isMethodBind,
  isModel,
  isNamedExpression,
  isNil,
  isNum,
  isObjectDef,
  isPiplingExpression,
  isPrimary,
  isRef,
  isStID,
  isStr,
  isTypeDef,
  type Assignment,
  type ComplexPrimary,
  type Expression,
  type ImportStatement,
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
  literalBaseName,
  nilType,
  numberType,
  stringType,
  unionOf,
  TypeEnv,
  type MethodSig,
  type ObjectTypeInfo,
  type TypeInfo,
} from './type-system.js'
import { resolveModuleName } from './module-path.js'

const objectDesc = '对象'

/**
 * 被导入模块的静态信息：result 是模块最后一条表达式的结果类型
 * （与运行时 interpret 返回 last 一致）；typeMembers 是该模块及其导入链里
 * 声明的全部类型别名，作为模块导出对象的类型成员（math#Circle），
 * 同时为兼容也平铺合并进导入方文档（直接按名引用）。
 */
export interface ImportedModuleType {
  result: TypeInfo
  typeMembers: Map<string, { type: TypeInfo; params: string[] }>
}

/**
 * 解析 #import 路径到模块静态信息：从已加载文档取被导入模块。
 * 返回 undefined 表示文档不可见（尚未加载/构建），调用方回退到 anyType。
 */
export type ImportResolver = (
  importPath: string,
  fromPath: string,
) => ImportedModuleType | undefined

/**
 * 构造 import 类型解析器。文档必须已加载（LSP 由 DocumentBuilder 全量构建；
 * 解释器路径由 execDocument 预加载导入文档树），这里只做同步查找。
 * visiting 用于环形导入去重：A→B→A 时回退 anyType，避免无限递归。
 */
export function createImportResolver(
  documents: LangiumDocuments,
  extensions: readonly string[],
): ImportResolver {
  const visiting = new Set<string>()
  const resolve: ImportResolver = (importPath, fromPath) => {
    const fileName = resolveModuleName(importPath, fromPath, extensions)
    if (visiting.has(fileName)) {
      return undefined
    }
    const doc = documents.getDocument(URI.file(fileName))
    if (!doc) {
      return undefined
    }
    const model = doc.parseResult.value
    if (!isModel(model)) {
      return undefined
    }
    visiting.add(fileName)
    try {
      return new ObjectOrientedCTypeChecker(resolve).inferModuleResult(model)
    } finally {
      visiting.delete(fileName)
    }
  }
  return resolve
}

/**
 * 静态类型检查器：类型只是装饰，全部以 warning 形式报告，不阻断执行。
 */
export class ObjectOrientedCTypeChecker {
  private readonly typedefs = new Map<string, TypeInfo>()
  private readonly typedefParams = new Map<string, string[]>()

  constructor(private readonly importResolver?: ImportResolver) {}

  checkModel(model: Model, accept: ValidationAcceptor): void {
    this.typedefs.clear()
    this.typedefParams.clear()
    const env = new TypeEnv()
    for (const stmt of model.expressions) {
      this.checkTopStatement(stmt, env, accept)
    }
  }

  /**
   * 供 hover 等只读场景使用：推断表达式的类型，不产生任何诊断。
   * 类型环境按顶层语句顺序建立，与检查器一致。Expression 与 Primary 均可。
   */
  inferType(node: AstNode): TypeInfo {
    const env = new TypeEnv()
    const model = AstUtils.getContainerOfType(node, isModel)
    const accept: ValidationAcceptor = () => undefined
    this.typedefs.clear()
    this.typedefParams.clear()
    if (model) {
      for (const stmt of model.expressions) {
        this.checkTopStatement(stmt, env, accept)
      }
    }
    if (isPiplingExpression(node) || isMessageOrChain(node)) {
      return this.inferExpression(node, env, accept)
    }
    if (isImportStatement(node)) {
      return env.lookup(node.name) ?? anyType
    }
    if (isPrimary(node)) {
      return this.inferPrimary(node, env, accept)
    }
    return anyType
  }

  /**
   * 推断被导入模块的静态信息：#import 模块的绑定类型 = 模块最后一条表达式的结果
   * （与运行时 interpret 返回 last 表达式一致），并收集模块内全部 typedef 供导入方跨文档使用。
   */
  inferModuleResult(model: Model): ImportedModuleType {
    this.typedefs.clear()
    this.typedefParams.clear()
    const env = new TypeEnv()
    const accept: ValidationAcceptor = () => undefined
    let last: TypeInfo = nilType
    for (const stmt of model.expressions) {
      if (isImportStatement(stmt)) {
        this.applyImport(stmt, env)
        continue
      }
      if (isTypeDef(stmt)) {
        this.checkTypeDef(stmt, env, accept)
        continue
      }
      if (isAssignment(stmt)) {
        this.checkAssignment(stmt, env, accept)
        continue
      }
      last = this.inferExpression(stmt, env, accept)
    }
    return {
      result: last,
      typeMembers: this.exportedTypeMembers(),
    }
  }

  /** 模块及其导入链里声明的全部 typedef，作为模块导出对象的类型成员 */
  private exportedTypeMembers(): Map<string, { type: TypeInfo; params: string[] }> {
    const members = new Map<string, { type: TypeInfo; params: string[] }>()
    for (const [name, type] of this.typedefs) {
      members.set(name, { type, params: this.typedefParams.get(name) ?? [] })
    }
    return members
  }

  /**
   * 处理 #import：绑定名类型 = 模块结果类型（对象时挂上模块的类型成员，
   * 支持 math#Circle 命名空间访问）；同时为兼容把模块 typedef 平铺合并进当前文档。
   * 文档不可见时回退 anyType。
   */
  private applyImport(stmt: ImportStatement, env: TypeEnv): void {
    let imported: ImportedModuleType | undefined
    if (this.importResolver) {
      const fromPath = AstUtils.getDocument(stmt)?.uri.path
      if (fromPath) {
        imported = this.importResolver(stmt.path, fromPath)
      }
    }
    if (!imported) {
      env.define(stmt.name, anyType)
      return
    }
    for (const [name, member] of imported.typeMembers) {
      if (!this.typedefs.has(name)) {
        this.typedefs.set(name, member.type)
        this.typedefParams.set(name, member.params)
      }
    }
    env.define(stmt.name, this.withTypeMembers(imported.result, imported.typeMembers, stmt.name))
  }

  /** 把类型成员挂到模块绑定类型上：对象时复制合并，否则包成仅含类型成员的对象 */
  private withTypeMembers(
    result: TypeInfo,
    members: Map<string, { type: TypeInfo; params: string[] }>,
    moduleName: string,
  ): TypeInfo {
    if (members.size === 0) {
      return result
    }
    const base: ObjectTypeInfo =
      result.kind === 'object'
        ? {
            kind: 'object',
            name: moduleName,
            methods: new Map(result.methods),
            parent: result.parent,
            extendsType: result.extendsType,
          }
        : { kind: 'object', name: moduleName, methods: new Map() }
    base.typeMembers = new Map(members)
    return base
  }

  private checkTopStatement(
    stmt: Model['expressions'][number],
    env: TypeEnv,
    accept: ValidationAcceptor,
  ): void {
    if (isImportStatement(stmt)) {
      this.applyImport(stmt, env)
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
        data: diagnosticData('duplicateType'),
      })
    }
    // 泛型类型参数名：body 里出现的这些名字是占位，实例化时替换
    const typeParams = stmt.typeParams.map((p) => p.name)
    // 先注册占位，支持自引用
    const placeholder: ObjectTypeInfo = { kind: 'object', methods: new Map() }
    this.typedefs.set(stmt.name, placeholder)
    this.typedefParams.set(stmt.name, typeParams)
    env.define(stmt.name, placeholder)
    for (const member of stmt.body.members) {
      const name = this.getMethodName(member.name)
      const sigs = placeholder.methods.get(name) ?? []
      sigs.push({
        params: member.params.map((p) =>
          this.resolveParamAnnotation(p, accept, typeParams, env),
        ),
        rest: undefined,
        returns: member.typeAnnotation
          ? this.resolveAnnotation(member.typeAnnotation, accept, typeParams, env)
          : anyType,
      })
      placeholder.methods.set(name, sigs)
    }
    placeholder.name = stmt.name
    // 继承：'...' 父类型（单继承，父类型联合时 A 本身变成联合）
    const parent = stmt.body.extends
      ? this.resolveAnnotation(stmt.body.extends, accept, typeParams, env)
      : undefined
    if (!parent) {
      this.registerTypeDef(stmt.name, placeholder, typeParams, env)
      return
    }
    if (parent.kind === 'object') {
      // 单继承：合并父类型形状，自己的方法覆盖同名
      this.mergeParentMethods(placeholder, parent)
      this.registerTypeDef(stmt.name, placeholder, typeParams, env)
      return
    }
    if (parent.kind === 'union') {
      // A 变成联合：每个分支 = 父联合成员 + 自己的方法
      const ownMethods = new Map(placeholder.methods)
      const branches = parent.types.map((m) => {
        if (m.kind !== 'object') {
          return m
        }
        const branch: ObjectTypeInfo = {
          kind: 'object',
          name: stmt.name,
          methods: new Map(m.methods),
        }
        for (const [k, sigs] of ownMethods) {
          branch.methods.set(k, sigs)
        }
        branch.parent = m.name ?? describeType(m)
        return branch
      })
      this.registerTypeDef(stmt.name, unionOf(branches), typeParams, env)
      return
    }
    // 其余（类型参数占位、内置名等）：保留 extendsType，实例化时处理
    placeholder.extendsType = parent
    placeholder.parent = describeType(parent)
    this.registerTypeDef(stmt.name, placeholder, typeParams, env)
  }

  private mergeParentMethods(
    target: ObjectTypeInfo,
    parent: ObjectTypeInfo,
  ): void {
    for (const [k, v] of parent.methods) {
      if (!target.methods.has(k)) {
        target.methods.set(k, v)
      }
    }
    target.parent = parent.name ?? describeType(parent)
    target.extendsType = parent
  }

  private registerTypeDef(
    name: string,
    type: TypeInfo,
    params: string[],
    env: TypeEnv,
  ): void {
    this.typedefs.set(name, type)
    this.typedefParams.set(name, params)
    env.define(name, type)
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
      const expected = stmt.typeAnnotation
        ? this.resolveAnnotation(stmt.typeAnnotation, accept, undefined, env)
        : undefined
      env.define(stmt.name, t)
      this.collectObject(objDef, env, accept, t)
      // 注解类型作为上下文传入对象字面量方法体：无注解参数按声明签名回填
      this.checkObjectBody(objDef, env, t, accept, expected)
      const declared = this.checkAnnotation(
        stmt.typeAnnotation,
        t,
        accept,
        expected,
        env,
      )
      env.define(stmt.name, declared)
      return
    }
    const inferred = this.inferExpression(stmt.expression, env, accept)
    const declared = this.checkAnnotation(
      stmt.typeAnnotation,
      inferred,
      accept,
      undefined,
      env,
    )
    const prev = env.lookup(stmt.name)
    if (prev && prev.kind !== 'any' && declared.kind !== 'any') {
      if (!isSubtype(declared, prev)) {
        accept(
          'warning',
          `重新赋值类型不匹配：'${stmt.name}' 期望 ${describeType(prev)}，却得到了 ${describeType(declared)}`,
          { node: stmt, property: 'name', data: diagnosticData('reassignmentMismatch') },
        )
      }
    }
    env.define(stmt.name, declared)
  }

  private checkAnnotation(
    annotation: Type | undefined,
    inferred: TypeInfo,
    accept: ValidationAcceptor,
    expected?: TypeInfo,
    env?: TypeEnv,
  ): TypeInfo {
    if (!annotation) {
      return inferred
    }
    const exp = expected ?? this.resolveAnnotation(annotation, accept, undefined, env)
    if (!isSubtype(inferred, exp)) {
      accept(
        'warning',
        `类型不匹配：期望 ${describeType(exp)}，却得到了 ${describeType(inferred)}`,
        { node: annotation, property: 'parts', data: diagnosticData('typeMismatch') },
      )
    }
    // 注解类型获胜：后续按声明类型检查
    return exp
  }

  private collectObject(
    objDef: ObjectDef,
    env: TypeEnv,
    accept: ValidationAcceptor,
    objType: ObjectTypeInfo = { kind: 'object', methods: new Map() },
  ): ObjectTypeInfo {
    if (objDef.extends) {
      const parent = env.lookup(objDef.extends.value) ?? anyType
      if (parent.kind === 'object') {
        // 单继承：父类型的方法合并进类型形状，运行时是方法路由的策略链
        objType.parent = objDef.extends.value
        for (const [k, v] of parent.methods) {
          objType.methods.set(k, v)
        }
      }
    }
    for (const method of objDef.methods) {
      this.collectMethod(method, objType, accept, env)
    }
    return objType
  }

  private collectMethod(
    method: Method,
    objType: ObjectTypeInfo,
    accept: ValidationAcceptor,
    env: TypeEnv,
  ): void {
    const name = this.getMethodName(method.name)
    const sigs = objType.methods.get(name) ?? []
    if (isMethodAll(method)) {
      // 方法级泛型参数：map<T>(...) 里 T 是占位，调用时按实参推断
      const methodTypeParams = method.typeParams.map((p) => p.name)
      sigs.push({
        params: method.params.map((p) =>
          this.resolveParamAnnotation(p, accept, methodTypeParams, env),
        ),
        rest: method.restParam
          ? (method.restParam.typeAnnotation
              ? this.resolveAnnotation(
                  method.restParam.typeAnnotation,
                  accept,
                  methodTypeParams,
                  env,
                )
              : anyType)
          : undefined,
        returns: method.returnType
          ? this.resolveAnnotation(
              method.returnType,
              accept,
              methodTypeParams,
              env,
            )
          : anyType,
        typeParams:
          methodTypeParams.length > 0 ? methodTypeParams : undefined,
      })
    } else {
      sigs.push({
        params: [],
        returns: method.typeAnnotation
          ? this.resolveAnnotation(method.typeAnnotation, accept, undefined, env)
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
    context?: TypeInfo,
  ): void {
    const bodyEnv = env.child()
    bodyEnv.define('this', objType)
    bodyEnv.define('currentObject', objType)
    bodyEnv.define('responser', anyType)
    const overloads: { method: MethodAll; returns: TypeInfo }[] = []
    for (const method of objDef.methods) {
      const name = this.getMethodName(method.name)
      // 上下文类型：注解声明的同名方法签名，用于回填无注解参数
      const contextSigs =
        context && context.kind === 'object'
          ? context.methods.get(name)
          : undefined
      const contextSig =
        contextSigs && contextSigs.length > 0
          ? contextSigs[contextSigs.length - 1]
          : undefined
      if (isMethodBind(method)) {
        const inferred = this.inferExpression(method.expression, bodyEnv, accept)
        this.checkAnnotation(method.typeAnnotation, inferred, accept, undefined, bodyEnv)
        const sigs = objType.methods.get(name)
        if (sigs && sigs.length > 0) {
          const last = sigs[sigs.length - 1]
          if (!method.typeAnnotation) {
            last.returns = inferred
          }
        }
        continue
      }
      const sig = this.checkMethod(method, bodyEnv, accept, contextSig)
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
            { node: b.method, property: 'name', data: diagnosticData('overloadReturnMismatch') },
          )
        }
      }
    }
  }

  private checkMethod(
    method: MethodAll,
    env: TypeEnv,
    accept: ValidationAcceptor,
    context?: MethodSig,
  ): MethodSig {
    const methodEnv = env.child()
    // 方法级泛型参数：map<T>(...) 里 T 在方法体内是类型占位
    const methodTypeParams = method.typeParams.map((p) => p.name)
    for (const p of methodTypeParams) {
      methodEnv.define(p, { kind: 'name', name: p })
    }
    const params = method.params.map((p, i) =>
      this.bindParam(p, methodEnv, accept, context?.params[i]),
    )
    const rest = this.bindParam(
      method.restParam,
      methodEnv,
      accept,
      context?.rest,
    )
    const declaredReturn = method.returnType
      ? this.resolveAnnotation(method.returnType, accept, undefined, methodEnv)
      : anyType
    if (method.guardExpression) {
      // 可区分联合的判别收窄：
      //   #guard (x kind) == 'circle'  → x 收窄为 kind 返回 'circle' 的成员
      //   #guard (x kind) != 'circle'  → x 收窄为其余成员
      this.narrowByTag(method.guardExpression, methodEnv)
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
          { node: method.guardExpression, data: diagnosticData('guardNotBoolean') },
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
      this.checkAnnotation(method.returnType, returnType, accept, undefined, methodEnv)
    }
    return {
      params,
      rest,
      returns: method.returnType ? declaredReturn : returnType,
      typeParams: methodTypeParams.length > 0 ? methodTypeParams : undefined,
    }
  }

  private bindParam(
    param: Param | undefined,
    env: TypeEnv,
    accept: ValidationAcceptor,
    contextType?: TypeInfo,
  ): TypeInfo | undefined {
    if (!param) {
      return undefined
    }
    if (!param.typeAnnotation && !contextType) {
      // 隐式 any：既无注解也无调用上下文可回填，参数类型退化为 any。
      // 默认不报告（noImplicitAny 默认 off），在 ooc.json 中配置为
      // warning/error 后才会提示。
      accept('warning', `参数 '${param.name}' 缺少类型注解，推断为隐式 any`, {
        node: param,
        property: 'name',
        data: diagnosticData('noImplicitAny'),
      })
    }
    const t = param.typeAnnotation
      ? this.resolveAnnotation(param.typeAnnotation, accept, undefined, env)
      : contextType ?? anyType
    env.define(param.name, t)
    return t
  }

  // ----- 可区分联合：guard 判别收窄 -----

  /**
   * 从 guard 表达式中提取判别测试：
   *   #guard (x kind) == 'circle' / #guard x kind != 'square'
   * 返回 { target: 被判别变量, method: 判别方法, value: 字面量, negate: 是否 != }
   */
  private extractTagTest(
    e: Expression,
  ): {
    target: string
    method: string
    value: TypeInfo
    negate: boolean
  } | undefined {
    if (!isPiplingExpression(e)) {
      return undefined
    }
    const right = e.right
    if (
      !isMessageInfixRight(right) ||
      (right.infix !== '==' && right.infix !== '!=')
    ) {
      return undefined
    }
    const value = this.literalOfPrimary(right.value)
    if (!value) {
      return undefined
    }
    const call = this.extractMethodCall(e.left)
    if (!call) {
      return undefined
    }
    return {
      target: call.target,
      method: call.method,
      value,
      negate: right.infix === '!='
    }
  }

  private literalOfPrimary(p: Primary): TypeInfo | undefined {
    if (isStr(p)) {
      return { kind: 'literal', value: p.value }
    }
    if (isNum(p)) {
      return { kind: 'literal', value: p.value }
    }
    if (isBool(p)) {
      return { kind: 'literal', value: p.value === 'true' }
    }
    return undefined
  }

  /** 提取 (x kind) 或 x kind 形式的无参方法调用 */
  private extractMethodCall(
    e: Expression,
  ): { target: string; method: string } | undefined {
    if (!isMessageOrChain(e)) {
      return undefined
    }
    if (e.message) {
      if (!isRef(e.primary) || e.message.args.length > 0) {
        return undefined
      }
      return {
        target: e.primary.value,
        method: this.getMessageName(e.message),
      }
    }
    // (x kind)：括号包一层 ComplexPrimary
    const p = e.primary
    if (isComplexPrimary(p)) {
      if (isObjectDef(p) || isLambdaDef(p)) {
        return undefined
      }
      return this.extractMethodCall(p)
    }
    return undefined
  }

  /** 按判别测试收窄联合变量 */
  private narrowByTag(guardExpr: Expression, env: TypeEnv): void {
    const test = this.extractTagTest(guardExpr)
    if (!test) {
      return
    }
    const current = env.lookup(test.target)
    if (!current || current.kind !== 'union') {
      return
    }
    const narrowed = current.types.filter((member) => {
      const match = this.memberTagMatches(member, test.method, test.value)
      return test.negate ? !match : match
    })
    if (narrowed.length === 0) {
      return
    }
    env.define(
      test.target,
      narrowed.length === 1 ? narrowed[0] : unionOf(narrowed),
    )
  }

  /** 联合成员的方法签名是否返回该字面量（判别匹配） */
  private memberTagMatches(
    member: TypeInfo,
    method: string,
    value: TypeInfo,
  ): boolean {
    if (member.kind !== 'object') {
      return false
    }
    const sigs = member.methods.get(method)
    if (!sigs) {
      return false
    }
    return sigs.some(
      (s) =>
        s.returns.kind === 'literal' &&
        value.kind === 'literal' &&
        s.returns.value === value.value,
    )
  }

  private resolveParamAnnotation(
    param: Param | undefined,
    accept: ValidationAcceptor,
    typeParams?: string[],
    env?: TypeEnv,
  ): TypeInfo | undefined {
    if (!param) {
      return undefined
    }
    if (!param.typeAnnotation) {
      return anyType
    }
    return this.resolveAnnotation(param.typeAnnotation, accept, typeParams, env)
  }

  private resolveAnnotation(
    type: Type,
    accept: ValidationAcceptor,
    typeParams?: string[],
    env?: TypeEnv,
  ): TypeInfo {
    const resolved = type.parts.map((part) =>
      this.resolveTypeName(part, accept, typeParams, env),
    )
    return unionOf(resolved)
  }

  private resolveTypeName(
    part: TypeName,
    accept: ValidationAcceptor,
    typeParams?: string[],
    env?: TypeEnv,
  ): TypeInfo {
    const n = part.name
    // 命名空间访问：math#Circle（模块导出对象的类型成员）或 math#add（方法返回类型）
    if (part.ns) {
      return this.resolveNamespaceMember(part, accept, typeParams, env)
    }
    // 字面量类型：'circle' / 42 / true，用于可区分联合的判别
    if (typeof n !== 'string') {
      if (isNil(n)) {
        return nilType
      }
      if (isBool(n)) {
        return { kind: 'literal', value: n.value === 'true' }
      }
      if (isStr(n)) {
        return { kind: 'literal', value: n.value }
      }
      if (isNum(n)) {
        return { kind: 'literal', value: n.value }
      }
      return anyType
    }
    // 当前 typedef 的类型参数占位：实例化时替换
    if (typeParams?.includes(n)) {
      return { kind: 'name', name: n }
    }
    // 环境中的类型参数占位（checkMethod 把方法级泛型参数 T 定义进方法环境）
    const named = env?.lookup(n)
    if (named?.kind === 'name' && named.name === n) {
      return named
    }
    switch (n) {
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
    }
    const template = this.typedefs.get(n)
    // 泛型实例化：Box<T> 里的实参替换模板中的类型参数
    if (template && part.typeArgs && part.typeArgs.length > 0) {
      const params = this.typedefParams.get(n) ?? []
      if (params.length === 0) {
        accept(
          'warning',
          `类型 '${n}' 不是泛型，不需要类型参数`,
          { node: part, data: diagnosticData('notGeneric') },
        )
        return anyType
      }
      const args = part.typeArgs.map((t) =>
        this.resolveAnnotation(t, accept, typeParams, env),
      )
      if (params.length !== args.length) {
        accept(
          'warning',
          `类型 '${n}' 期望 ${params.length} 个类型参数，却给了 ${args.length} 个`,
          { node: part, data: diagnosticData('typeArgCount') },
        )
        return anyType
      }
      return instantiate(template, params, args)
    }
    if (template) {
      // 泛型 typedef 未实例化：警告并按 any 处理
      if ((this.typedefParams.get(n)?.length ?? 0) > 0) {
        accept(
          'warning',
          `泛型类型 '${n}' 缺少类型参数，按 any 处理`,
          { node: part, property: 'name', data: diagnosticData('missingTypeArg') },
        )
        return anyType
      }
      return template
    }
    accept('warning', `未知类型 '${n}'`, {
      node: part,
      property: 'name',
      data: diagnosticData('unknownType'),
    })
    return anyType
  }

  /**
   * math#Circle：模块导出对象类型下的类型成员（#import 挂载的 typedef）。
   * math#add：对象类型下方法 add 的返回类型（同像性：方法与类型同处对象）。
   * 泛型成员 math#Box<number> 按类型参数实例化。
   */
  private resolveNamespaceMember(
    part: TypeName,
    accept: ValidationAcceptor,
    typeParams: string[] | undefined,
    env: TypeEnv | undefined,
  ): TypeInfo {
    const nsName = part.ns!
    const nsType = env?.lookup(nsName)
    if (!nsType || nsType.kind !== 'object') {
      accept(
        'warning',
        `命名空间 '${nsName}' 不是对象类型，无法访问 '${nsName}#${part.name}'`,
        { node: part, property: 'ns', data: diagnosticData('unknownType') },
      )
      return anyType
    }
    const memberName =
      typeof part.name === 'string' ? part.name : String(part.name.value)
    const member = nsType.typeMembers?.get(memberName)
    if (member) {
      if (part.typeArgs && part.typeArgs.length > 0) {
        if (member.params.length === 0) {
          accept(
            'warning',
            `类型 '${part.ns}#${memberName}' 不是泛型，不需要类型参数`,
            { node: part, data: diagnosticData('notGeneric') },
          )
          return anyType
        }
        const args = part.typeArgs.map((t) =>
          this.resolveAnnotation(t, accept, typeParams, env),
        )
        if (args.length !== member.params.length) {
          accept(
            'warning',
            `类型 '${part.ns}#${memberName}' 期望 ${member.params.length} 个类型参数，却给了 ${args.length} 个`,
            { node: part, data: diagnosticData('typeArgCount') },
          )
          return anyType
        }
        return instantiate(member.type, member.params, args)
      }
      if (member.params.length > 0) {
        accept(
          'warning',
          `泛型类型 '${part.ns}#${memberName}' 缺少类型参数，按 any 处理`,
          {
            node: part,
            property: 'name',
            data: diagnosticData('missingTypeArg'),
          },
        )
        return anyType
      }
      return member.type
    }
    // 方法返回类型：math#add = add 方法的返回类型
    const sigs = nsType.methods.get(memberName)
    if (sigs && sigs.length > 0) {
      const sig = sigs[sigs.length - 1]
      if (sig.typeParams && sig.typeParams.length > 0) {
        // 泛型方法未实例化：占位按 any
        return instantiate(
          sig.returns,
          sig.typeParams,
          sig.typeParams.map(() => anyType),
        )
      }
      return sig.returns
    }
    accept('warning', `类型 '${part.ns}#${memberName}' 不存在`, {
      node: part,
      property: 'ns',
      data: diagnosticData('unknownType'),
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
        // 管道命名：x | p => expr，p 的类型就是左侧结果
        const pipeEnv = env.child()
        pipeEnv.define(value.param, left)
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
    const lb = baseNameOf(left)
    const rb = baseNameOf(right)
    if (lb === 'number' && rb === 'number') {
      return numberType
    }
    if (infix === '+' && (lb === 'string' || rb === 'string')) {
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
    const name = this.getMessageName(message)
    const argTypes = message.args.map((arg, i) =>
      this.inferArg(arg, i, receiver, name, env, accept),
    )
    return this.dispatch(receiver, name, argTypes, accept, message)
  }

  /**
   * 推断方法调用实参。若实参是匿名对象 / lambda，且接收者对应位置的签名参数是
   * 对象类型，则以该类型为上下文回填，方法体/函数体内参数可省略注解。
   */
  private inferArg(
    arg: Primary,
    i: number,
    receiver: TypeInfo,
    name: string,
    env: TypeEnv,
    accept: ValidationAcceptor,
  ): TypeInfo {
    const sigs = this.resolveSigs(receiver, name) ?? []
    const expected = sigs
      .map((s) => s.params[i])
      .find((p) => p && p.kind === 'object')
    if (expected && expected.kind === 'object') {
      if (isObjectDef(arg)) {
        return this.inferComplexPrimary(arg, env, accept, expected)
      }
      if (isLambdaDef(arg)) {
        return this.inferComplexPrimary(arg, env, accept, expected)
      }
    }
    return this.inferPrimary(arg, env, accept)
  }

  /** 解析接收者上 name 消息的所有候选签名，供实参回填使用 */
  private resolveSigs(
    receiver: TypeInfo,
    name: string,
  ): MethodSig[] | undefined {
    switch (receiver.kind) {
      case 'any':
        return undefined
      case 'name':
        return getBuiltinMethods(receiver.name).get(name)
      case 'literal':
        return getBuiltinMethods(literalBaseName(receiver.value)).get(name)
      case 'object':
        return receiver.methods.get(name)
      case 'union': {
        const all: MethodSig[] = []
        for (const sub of receiver.types) {
          const s = this.resolveSigs(sub, name)
          if (s) {
            all.push(...s)
          }
        }
        return all.length > 0 ? all : undefined
      }
      default:
        return undefined
    }
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
        const { withMethod, without } = this.splitByMethod(receiver.types, name)
        if (withMethod.length === 0) {
          return anyType
        }
        if (without.length > 0) {
          // 可区分联合：只有部分成员有该方法，需要先判别收窄
          accept(
            'warning',
            `消息 '${name}' 只定义在部分联合成员上（${withMethod.map(describeType).join(' | ')}），${without.map(describeType).join(' | ')} 上没有，需要先判别（如 #guard (x kind) == '...'）`,
            { node, data: diagnosticData('partialUnionMessage') },
          )
          return anyType
        }
        const results = withMethod.map((sub) =>
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
      case 'literal':
        // 字面量按基础类型派发：'circle' length 等价于 string length
        return this.dispatch(
          { kind: 'name', name: literalBaseName(receiver.value) },
          name,
          args,
          accept,
          node,
        )
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

  /** 联合成员按是否定义消息 name 分组 */
  private splitByMethod(
    members: TypeInfo[],
    name: string,
  ): { withMethod: TypeInfo[]; without: TypeInfo[] } {
    const withMethod: TypeInfo[] = []
    const without: TypeInfo[] = []
    for (const m of members) {
      if (this.hasMethod(m, name)) {
        withMethod.push(m)
      } else {
        without.push(m)
      }
    }
    return { withMethod, without }
  }

  /** 类型是否定义了消息 name（any/function 视为都有，鸭辨） */
  private hasMethod(t: TypeInfo, name: string): boolean {
    switch (t.kind) {
      case 'any':
      case 'function':
        return true
      case 'name':
        return getBuiltinMethods(t.name).has(name)
      case 'literal':
        return getBuiltinMethods(literalBaseName(t.value)).has(name)
      case 'object':
        return (t.methods.get(name)?.length ?? 0) > 0
      case 'union':
        return t.types.every((sub) => this.hasMethod(sub, name))
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
    // 非泛型签名优先精确匹配
    for (const sig of sigs) {
      if (!sig.typeParams && this.argsCompatible(sig, args)) {
        return sig.returns
      }
    }
    // 方法泛型：map<T>(f: T -> U): U 从实参推断 T，实例化签名后匹配
    for (const sig of sigs) {
      if (!sig.typeParams) {
        continue
      }
      const inst = this.instantiateGenericSig(sig, args)
      if (this.argsCompatible(inst, args)) {
        return inst.returns
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
      { node, data: diagnosticData('callArgsMismatch') },
    )
    return sigs[0]?.returns ?? anyType
  }

  /**
   * 方法泛型实例化：（调用方视角）从实参类型推断签名里的占位类型参数。
   * 顶层占位参数直接绑定实参类型；无法由实参推断出的占位按 any 处理
   * （“未声明又不能推断，退回 any”）。随后用推断结果实例化参数/返回类型。
   */
  private instantiateGenericSig(
    sig: MethodSig,
    args: TypeInfo[],
  ): MethodSig {
    const typeParams = sig.typeParams!
    const mapping = new Map<string, TypeInfo>()
    for (let i = 0; i < sig.params.length && i < args.length; i++) {
      const p = sig.params[i]
      if (p && p.kind === 'name' && typeParams.includes(p.name)) {
        const prev = mapping.get(p.name)
        // 多次出现取联合：T 同时需满足 number | string
        mapping.set(p.name, prev ? unionOf([prev, args[i]]) : args[i])
      }
    }
    const types = typeParams.map((t) => mapping.get(t) ?? anyType)
    return {
      params: sig.params.map((p) =>
        p ? instantiate(p, typeParams, types) : undefined,
      ),
      rest: sig.rest ? instantiate(sig.rest, typeParams, types) : undefined,
      returns: instantiate(sig.returns, typeParams, types),
    }
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
    context?: TypeInfo,
  ): TypeInfo {
    if (isObjectDef(e)) {
      const t: ObjectTypeInfo = { kind: 'object', methods: new Map() }
      this.collectObject(e, env, accept, t)
      this.checkObjectBody(e, env, t, accept, context)
      return t
    }
    if (isLambdaDef(e)) {
      // 同像性：lambda 就是 { apply(...) { ... } }，类型即只有一个 apply 方法的对象。
      // 参数注解收集为 MethodSig，函数体最后一条表达式推断为返回类型。
      // context 为调用处回调签名时，无注解参数按 apply 签名回填。
      const applySig =
        context && context.kind === 'object'
          ? context.methods.get('apply')?.slice(-1)[0]
          : undefined
      const bodyEnv = env.child()
      const params: (TypeInfo | undefined)[] = []
      for (const [i, p] of e.params.entries()) {
        params.push(
          this.bindParam(p, bodyEnv, accept, applySig?.params[i]),
        )
      }
      let returns: TypeInfo = nilType
      for (const stmt of e.expressions) {
        if (isAssignment(stmt)) {
          this.checkAssignment(stmt, bodyEnv, accept)
        } else {
          returns = this.inferExpression(stmt, bodyEnv, accept)
        }
      }
      const t: ObjectTypeInfo = {
        kind: 'object',
        methods: new Map([
          ['apply', [{ params, rest: undefined, returns }]],
        ]),
      }
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
      return { kind: 'literal', value: p.value === 'true' }
    }
    if (isNil(p)) {
      return nilType
    }
    if (isNum(p)) {
      return { kind: 'literal', value: p.value }
    }
    if (isRef(p)) {
      return env.lookup(p.value) ?? anyType
    }
    if (isStr(p) || isStID(p)) {
      return {
        kind: 'literal',
        value: isStr(p) ? p.value : p.value.slice(1),
      }
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
    if (isRef(v)) {
      return v.value
    }
    if (isStID(v)) {
      return v.value.slice(1)
    }
    return v.value
  }
}

/** name / literal 都归到基础类型名，用于运算符推断 */
function baseNameOf(t: TypeInfo): string | undefined {
  switch (t.kind) {
    case 'name':
      return t.name
    case 'literal':
      return literalBaseName(t.value)
    default:
      return undefined
  }
}

/**
 * 泛型实例化：把模板中的类型参数占位（{kind:'name', name:T}）递归替换为实参。
 */
function instantiate(
  t: TypeInfo,
  params: string[],
  args: TypeInfo[],
): TypeInfo {
  switch (t.kind) {
    case 'name': {
      const idx = params.indexOf(t.name)
      return idx >= 0 ? args[idx] : t
    }
    case 'union':
      return unionOf(t.types.map((x) => instantiate(x, params, args)))
    case 'object': {
      const methods = new Map<string, MethodSig[]>()
      for (const [name, sigs] of t.methods) {
        methods.set(
          name,
          sigs.map((s) => ({
            params: s.params.map((p) =>
              p ? instantiate(p, params, args) : undefined,
            ),
            rest: s.rest ? instantiate(s.rest, params, args) : undefined,
            returns: instantiate(s.returns, params, args),
          })),
        )
      }
      if (t.extendsType) {
        const parent = instantiate(t.extendsType, params, args)
        if (parent.kind === 'object') {
          // 单继承：合并父类型形状，自己的方法覆盖同名
          for (const [k, v] of parent.methods) {
            if (!methods.has(k)) {
              methods.set(k, v)
            }
          }
          return {
            kind: 'object',
            name: t.name,
            methods,
            parent: parent.name ?? describeType(parent),
            extendsType: parent,
          }
        }
        if (parent.kind === 'union') {
          // 父类型实例化为联合：A 本身变成联合（每个分支 = 父成员 + 自己的方法）
          const branches = parent.types.map((m) => {
            if (m.kind !== 'object') {
              return m
            }
            const branch: ObjectTypeInfo = {
              kind: 'object',
              name: t.name,
              methods: new Map(m.methods),
            }
            for (const [k, sigs] of methods) {
              branch.methods.set(k, sigs)
            }
            branch.parent = m.name ?? describeType(m)
            return branch
          })
          return unionOf(branches)
        }
        return {
          kind: 'object',
          name: t.name,
          methods,
          parent: describeType(parent),
          extendsType: parent,
        }
      }
      return { kind: 'object', name: t.name, methods }
    }
    default:
      return t
  }
}
