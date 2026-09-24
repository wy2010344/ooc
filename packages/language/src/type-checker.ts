import type { AstNode, LangiumDocuments, ValidationAcceptor } from 'langium'
import { AstUtils, URI } from 'langium'
import { diagnosticData } from './diagnostics-config.js'
import {
  isAssignment,
  isBool,
  isCastExpression,
  isClassDef,
  isComplexPrimary,
  isImportList,
  isImportStatement,
  isLambdaDef,
  isMessageChainExt,
  isMessageInfixRight,
  isMessageOrChain,
  isMessagePipRight,
  isMethodAll,
  isMethodBind,
  isMethodBindMutable,
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
  type ClassDef,
  type ComplexPrimary,
  type Expression,
  type ImportItem,
  type ImportList,
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
  intersectionOf,
  unionOf,
  TypeEnv,
  type MethodSig,
  type ObjectTypeInfo,
  type TypeInfo,
} from './type-system.js'
import { resolveModuleName } from './module-path.js'
import {
  argsCompatible,
  instantiate,
  instantiateGenericSig,
  instantiateSigWithExplicitArgs,
} from './type-checker/generic-instantiator.js'

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

  constructor(
    private readonly importResolver?: ImportResolver,
    private readonly globalsTypes?: Map<string, TypeInfo>,
  ) {}

  /** 注入的全局桥接类型（供补全/hover 等只读场景展示全局对象名） */
  get globals(): Map<string, TypeInfo> | undefined {
    return this.globalsTypes
  }

  checkModel(model: Model, accept: ValidationAcceptor): void {
    // 语法错误时 AST 处于恢复状态（缺节点/半截表达式），类型检查会二次崩溃。
    // 语法问题交给 parser 诊断，这里直接跳过（IDE 边打字边校验是常态）。
    if (model.$document && model.$document.parseResult.parserErrors.length > 0) {
      return
    }
    this.typedefs.clear()
    this.typedefParams.clear()
    const env = new TypeEnv(undefined, this.globalsTypes)
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
    const members = this.exportedTypeMembers()
    return {
      result: this.withExportedTypeMembers(last, members),
      typeMembers: members,
    }
  }

  /**
   * 类型即值：模块导出对象（最后一条表达式的类型）直接携带本模块的类型成员，
   * 导入方无需二次包装即可 math#Circle 访问。result 非对象时保持原样，
   * 由导入方 withTypeMembers 兜底包成仅含类型成员的对象。
   */
  private withExportedTypeMembers(
    result: TypeInfo,
    members: Map<string, { type: TypeInfo; params: string[] }>,
  ): TypeInfo {
    if (members.size === 0 || result.kind !== 'object') {
      return result
    }
    const base: ObjectTypeInfo = {
      kind: 'object',
      name: result.name,
      methods: new Map(result.methods),
      parent: result.parent,
      extendsType: result.extendsType,
    }
    base.typeMembers = new Map(members)
    return base
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
   * 支持选择性类型导入：#import 'path' { Circle as C, Box }
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

    // 选择性类型导入：只导入指定的类型
    if (isImportList(stmt)) {
      const importList = stmt as ImportList
      for (const item of importList.items) {
        const originalName = item.name
        const alias = item.alias ?? originalName
        const member = imported.typeMembers.get(originalName)
        if (!member) {
          // 类型不存在的告警
          // 在 inferModuleResult 阶段，accept 是 no-op；在 validate 阶段重新报错
          // 这里只处理类型成员注册，验证在 checkTopStatement 的 accept 中完成
          continue
        }
        if (!this.typedefs.has(alias)) {
          this.typedefs.set(alias, member.type)
          this.typedefParams.set(alias, member.params)
        }
      }
    } else {
      // 全量导入：把所有类型成员平铺合并
      for (const [name, member] of imported.typeMembers) {
        if (!this.typedefs.has(name)) {
          this.typedefs.set(name, member.type)
          this.typedefParams.set(name, member.params)
        }
      }
    }

    // 导出侧已把类型成员挂在对象上（withExportedTypeMembers），直接用；
    // 只有 result 非对象时才兜底包装
    // 选择性导入时，只保留指定的类型成员
    const typeMembersForObject = isImportList(stmt)
      ? this.filterTypeMembersForObject(imported.typeMembers, (stmt as ImportList).items)
      : imported.typeMembers
    env.define(
      stmt.name,
      imported.result.kind === 'object' && imported.result.typeMembers
        ? isImportList(stmt)
          ? this.withTypeMembers(imported.result, typeMembersForObject, stmt.name)
          : imported.result
        : this.withTypeMembers(
            imported.result,
            typeMembersForObject,
            stmt.name,
          ),
    )
  }

  /** 选择性导入时，过滤出现在导入对象上的类型成员 */
  private filterTypeMembersForObject(
    allMembers: Map<string, { type: TypeInfo; params: string[] }>,
    items: ImportItem[],
  ): Map<string, { type: TypeInfo; params: string[] }> {
    const filtered = new Map<string, { type: TypeInfo; params: string[] }>()
    for (const item of items) {
      const originalName = item.name
      const alias = item.alias ?? originalName
      const member = allMembers.get(originalName)
      if (member) {
        filtered.set(alias, member)
      }
    }
    return filtered
  }

  /** 兜底：result 非对象时，把类型成员包成仅含类型成员的对象 */
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

  /**
   * 从 config.ooc 的 Model 收集「globals」成员对象里每个名字的类型，
   * 供宿主（LSP / CLI type-check）注入为全局类型。语义：
   * config.ooc 最后一条表达式是配置对象（执行 config.ooc 返回该值），
   * 其中 globals 成员列出要作为项目全局对象的名字（值需在本文件顶层声明）。
   * 没有 globals 成员时返回 undefined（不注入）。
   */
  collectConfigGlobals(model: Model): Map<string, TypeInfo> | undefined {
    const env = new TypeEnv(undefined, this.globalsTypes)
    const accept: ValidationAcceptor = () => undefined
    for (const stmt of model.expressions) {
      // 先注册顶层 #type（config.ooc 的 Component/Signal 等返回类型别名），
      // 否则方法返回注解解析成 anyType
      if (isTypeDef(stmt)) {
        this.checkTypeDef(stmt, env, accept)
        continue
      }
      if (!isAssignment(stmt)) {
        continue
      }
      const objDef = this.unwrapObjectDef(stmt.expression)
      if (objDef) {
        const t: ObjectTypeInfo = { kind: 'object', methods: new Map() }
        env.define(stmt.name, t)
        this.collectObject(objDef, env, accept, t)
        env.define(stmt.name, t)
      } else {
        env.define(
          stmt.name,
          this.inferExpression(stmt.expression, env, accept),
        )
      }
    }
    const last = model.expressions[model.expressions.length - 1]
    if (!last) {
      return undefined
    }
    const lastExpr = isAssignment(last)
      ? last.expression
      : (last as Expression)
    const configType = this.inferExpression(lastExpr, env, accept)
    const globalsSig =
      configType.kind === 'object'
        ? configType.methods.get('globals')?.[0]
        : undefined
    const globalsType = globalsSig?.returns
    if (!globalsType || globalsType.kind !== 'object') {
      return undefined
    }
    const out = new Map<string, TypeInfo>()
    for (const [name, sigs] of globalsType.methods) {
      const first = sigs[0]
      if (first) {
        out.set(name, first.returns)
      }
    }
    return out.size ? out : undefined
  }

  private checkTopStatement(
    stmt: Model['expressions'][number],
    env: TypeEnv,
    accept: ValidationAcceptor,
  ): void {
    if (isImportStatement(stmt)) {
      this.applyImport(stmt, env)
      // 选择性导入：验证每个导入项是否存在
      if (isImportList(stmt)) {
        this.validateSelectiveImport(stmt as ImportList, accept)
      }
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

  /** 验证选择性导入的类型是否存在于目标模块 */
  private validateSelectiveImport(
    stmt: ImportList,
    accept: ValidationAcceptor,
  ): void {
    let imported: ImportedModuleType | undefined
    if (this.importResolver) {
      const fromPath = AstUtils.getDocument(stmt)?.uri.path
      if (fromPath) {
        imported = this.importResolver(stmt.path, fromPath)
      }
    }
    if (!imported) {
      return
    }
    for (const item of stmt.items) {
      const member = imported.typeMembers.get(item.name)
      if (!member) {
        accept(
          'warning',
          `类型 '${item.name}' 在模块 '${stmt.path}' 中不存在`,
          { node: item, data: diagnosticData('typeNotFound') },
        )
      }
    }
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
      // 方法级泛型参数：只在方法签名内可见，不参与 typedef 层实例化；
      // 与 typedef 泛型同名时共享占位名（实例化后同名一并替换）
      const memberTypeParams = (member.typeParams ?? []).map((p) => p.name)
      const inScope = [...typeParams, ...memberTypeParams]
      const sigs = placeholder.methods.get(name) ?? []
      sigs.push({
        params: member.params.map((p) =>
          this.resolveParamAnnotation(p, accept, inScope, env),
        ),
        rest: undefined,
        returns: member.typeAnnotation
          ? this.resolveAnnotation(member.typeAnnotation, accept, inScope, env)
          : anyType,
        typeParams: memberTypeParams.length ? memberTypeParams : undefined,
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
    const classDef = this.unwrapClassDef(stmt.expression)
    if (classDef) {
      // 类定义：#classDef { 类方法 } { 实例方法 }，类对象类型 + 实例类型
      this.checkClassDef(stmt, classDef, env, accept)
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
        { node: annotation, property: 'first', data: diagnosticData('typeMismatch') },
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
    } else if (isMethodBindMutable(method)) {
      // 转发属性：本 key 的一切消息原样转发给委托对象的 apply 执行，
      // 因此静态签名 = 委托对象 apply 方法的签名。
      const delegateType = this.inferExpression(method.expression, env, accept)
      const applySigs = this.resolveSigs(delegateType, 'apply') ?? []
      if (applySigs.length > 0) {
        for (const s of applySigs) {
          sigs.push({ params: s.params, rest: s.rest, returns: s.returns })
        }
      } else {
        // 委托对象没有 apply：类型只能给出宽松兜底（参数任意、返回任意）。
        // 运行时也会因 methodNotFound 报错，故这里同时给出类型提示。
        accept(
          'error',
          `转发目标需要含 apply 方法，委托对象类型为 ${describeType(delegateType)}，其中没有 apply`,
          { node: method.expression, data: diagnosticData('delegateNoApply') },
        )
        sigs.push({ params: [], rest: anyType, returns: anyType })
      }
    } else {
      sigs.push({
        params: [],
        returns: method.typeAnnotation
          ? this.resolveAnnotation(method.typeAnnotation, accept, undefined, env)
          : this.inferExpression(method.expression, env, accept),
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
      if (isMethodBindMutable(method)) {
        // 转发属性：签名已在 collectMethod 按委托 apply 记录，
        // 这里只为副作用推断委托表达式（复用同一引用不再回填）。
        this.inferExpression(method.expression, bodyEnv, accept)
        continue
      }
      // 签名方法（无 body）：纯类型契约。只把声明放入 sig（dispatch 推断用），
      // 不检查 body、不参与重载返回一致性对比（TS 式：签名之间不强制返回一致）
      if (isMethodAll(method) && !method.body) {
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
    // 末尾兜底分支（guard 重载组的最后一个无条件落入分支）不参与比较：
    // 它是 guard 全不匹配时的运行时兜底，类型无需与守卫分支一致。
    const fallbackMethods = new Set<MethodAll>()
    {
      const byName = new Map<string, MethodAll[]>()
      for (const o of overloads) {
        const n = this.getMethodName(o.method.name)
        const g = byName.get(n)
        if (g) {
          g.push(o.method)
        } else {
          byName.set(n, [o.method])
        }
      }
      for (const group of byName.values()) {
        const hasGuard = group.some((m) => m.body?.guardExpression)
        if (hasGuard && group.length > 1) {
          fallbackMethods.add(group[group.length - 1])
        }
      }
    }
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
        if (fallbackMethods.has(a.method) || fallbackMethods.has(b.method)) {
          continue
        }
        if (this.getMethodName(a.method.name) !== this.getMethodName(b.method.name)) {
          continue
        }
        // 可区分联合的判别分支（同一判别目标/方法）各自返回字面量可不同：与 TS 签名豁免同理
        const aTest =
          a.method.body?.guardExpression &&
          this.extractTagTest(a.method.body.guardExpression)
        const bTest =
          b.method.body?.guardExpression &&
          this.extractTagTest(b.method.body.guardExpression)
        if (
          aTest &&
          bTest &&
          aTest.target === bTest.target &&
          aTest.method === bTest.method
        ) {
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
    // 可区分联合全覆盖：按方法名分组实现方法，第一个参数注解是联合时枚举覆盖
    const implGroups = new Map<string, MethodAll[]>()
    for (const method of objDef.methods) {
      if (
        isMethodAll(method) &&
        method.body &&
        method.params &&
        method.params.length > 0
      ) {
        const n = this.getMethodName(method.name)
        const g = implGroups.get(n)
        if (g) {
          g.push(method)
        } else {
          implGroups.set(n, [method])
        }
      }
    }
    for (const [n, group] of implGroups) {
      this.checkUnionCoverage(n, group, bodyEnv, accept)
    }
  }

  /**
   * 类定义类型：#classDef { 类方法 } { 实例方法 }。
   * 类对象类型 methods 挂类（静态）方法，new 的返回类型固定为实例类型；
   * 实例类型挂在类类型的 instanceType 上供派发。
   */
  private checkClassDef(
    stmt: Assignment,
    classDef: ClassDef,
    env: TypeEnv,
    accept: ValidationAcceptor,
  ): void {
    const classType: ObjectTypeInfo = {
      kind: 'object',
      name: stmt.name,
      methods: new Map(),
    }
    const instanceType: ObjectTypeInfo = {
      kind: 'object',
      name: stmt.name,
      methods: new Map(),
    }
    // 收集两条方法块的签名
    for (const m of classDef.classMethods) {
      this.collectMethod(m, classType, accept, env)
    }
    for (const m of classDef.instanceMethods) {
      this.collectMethod(m, instanceType, accept, env)
    }
    // new 的返回类型固定为实例类型；没声明也提供一个默认构造
    const newSigs = classType.methods.get('new')
    if (newSigs && newSigs.length > 0) {
      newSigs.forEach((s) => (s.returns = instanceType))
    } else {
      classType.methods.set('new', [{ params: [], returns: instanceType }])
    }
    classType.instanceType = instanceType
    this.checkClassBodies(classDef, env, classType, instanceType, accept)
    // 类名在定义完成后才对后续语句可见（与运行时作用域一致）
    env.define(stmt.name, classType)
  }

  /** 检查类/实例方法体（复用对象方法体的重载检查；new 单独按构造检查）。 */
  private checkClassBodies(
    classDef: ClassDef,
    env: TypeEnv,
    classType: ObjectTypeInfo,
    instanceType: ObjectTypeInfo,
    accept: ValidationAcceptor,
  ): void {
    // 类方法（去掉 new）
    const classMethods = classDef.classMethods.filter(
      (m) => this.getMethodName(m.name) !== 'new',
    )
    this.checkObjectBody(
      { methods: classMethods } as unknown as ObjectDef,
      env,
      classType,
      accept,
    )
    // 构造方法：self 指向实例（实例状态写入实例自身）
    const newDef = classDef.classMethods.find(
      (m) => this.getMethodName(m.name) === 'new' && isMethodAll(m),
    ) as MethodAll | undefined
    if (newDef) {
      const newEnv = env.child()
      newEnv.define('self', instanceType)
      newEnv.define('this', instanceType)
      this.checkMethod(newDef, newEnv, accept)
    }
    // 实例方法
    this.checkObjectBody(
      { methods: classDef.instanceMethods } as unknown as ObjectDef,
      env,
      instanceType,
      accept,
    )
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
    if (method.body?.guardExpression) {
      // 可区分联合的判别收窄：
      //   #guard (x kind) == 'circle'  → x 收窄为 kind 返回 'circle' 的成员
      //   #guard (x kind) != 'circle'  → x 收窄为其余成员
      this.narrowByTag(method.body.guardExpression, methodEnv)
      const guardType = this.inferExpression(
        method.body.guardExpression,
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
          { node: method.body.guardExpression, data: diagnosticData('guardNotBoolean') },
        )
      }
    }
    let returnType: TypeInfo = nilType
    for (const stmt of method.body?.expressions ?? []) {
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
   *   #guard (x kind) == 'circle' / #guard x kind != 'square' / #guard x == 'circle'（字面量联合）
   * 返回 { target: 被判别变量, method: 判别方法（对象联合有、字面量联合为 undefined）, value: 字面量, negate: 是否 != }
   */
  private extractTagTest(
    e: Expression,
  ): {
    target: string
    method: string | undefined
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
    // 情形 1：(x kind) == 'circle'｜x kind == 'circle'（对象联合判别）
    const call = this.extractMethodCall(e.left)
    if (call) {
      return {
        target: call.target,
        method: call.method,
        value,
        negate: right.infix === '!='
      }
    }
    // 情形 2：x == 'circle'（字面量联合直接判别，左端是裸标识符）
    if (
      isMessageOrChain(e.left) &&
      !e.left.message &&
      isRef(e.left.primary)
    ) {
      return {
        target: e.left.primary.value,
        method: undefined,
        value,
        negate: right.infix === '!='
      }
    }
    return undefined
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
    e: Expression | ComplexPrimary,
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
    // 字面量联合（method 为空）收窄无意义：字面量不再拆成成员类型
    if (!test || !test.method) {
      return
    }
    const testMethod = test.method
    const current = env.lookup(test.target)
    if (!current || current.kind !== 'union') {
      return
    }
    const narrowed = current.types.filter((member) => {
      const match = this.memberTagMatches(member, testMethod, test.value)
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

  /**
   * 可区分联合全覆盖检查：同名实现方法组的第一个参数注解是联合时，
   * 枚举每个联合成员是否被某个 #guard 判别覆盖（对象联合按判别方法返回的
   * 字面量匹配，字面量联合按判别值直接相等）。缺分支报 unionUncovered。
   * 组内判别基准不一致（target/判别方法对不上）时跳过，避免误报。
   */
  private checkUnionCoverage(
    name: string,
    group: MethodAll[],
    env: TypeEnv,
    accept: ValidationAcceptor,
  ): void {
    const firstParam = group[0]?.params?.[0]
    if (!firstParam?.typeAnnotation) {
      return
    }
    const paramType = this.resolveAnnotation(
      firstParam.typeAnnotation,
      () => {},
      undefined,
      env,
    )
    if (paramType?.kind !== 'union') {
      return
    }
    const members = paramType.types
    // 收集每个 #guard 分支的判别；末尾无 guard 的兜底分支跳过（runtime 最后落入）。
    // 判别基准（target/判别方法）在 guard 分支间不一致时跳过，避免误报。
    const tests: {
      target: string
      method: string | undefined
      value: TypeInfo
      negate: boolean
    }[] = []
    for (const m of group) {
      const guardExpr = m.body?.guardExpression
      if (!guardExpr) {
        continue
      }
      const t = this.extractTagTest(guardExpr)
      if (!t || t.target !== firstParam.name) {
        return
      }
      tests.push(t)
    }
    if (tests.length === 0) {
      return
    }
    const disc = tests[0]!.method
    if (tests.some((t) => t.method !== disc)) {
      return
    }
    const missing = members.filter((member) => {
      return !tests.some((t) => {
        const match = disc
          ? this.memberTagMatches(member, disc, t.value)
          : member.kind === 'literal' &&
            t.value.kind === 'literal' &&
            member.value === t.value.value
        return t.negate ? !match : match
      })
    })
    if (missing.length > 0) {
      accept(
        'warning',
        `方法 '${name}' 的可区分联合覆盖不全：联合成员 ${missing.map(describeType).join('、')} 没有对应的 #guard 判别分支`,
        {
          node: group[0],
          property: 'name',
          data: diagnosticData('unionUncovered'),
        },
      )
    }
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
    // 解析第一个类型
    const firstResolved = this.resolveTypeName(type.first, accept, typeParams, env)
    
    // 无分隔符：单类型
    if (!type.seps || type.seps.length === 0) {
      return firstResolved
    }
    
    // 解析其余类型
    const allTypes = [firstResolved]
    for (let i = 0; i < type.rest.length; i++) {
      allTypes.push(this.resolveTypeName(type.rest[i], accept, typeParams, env))
    }
    
    // 检查是否包含交叉运算符（&）
    const hasIntersection = type.seps.some(sep => sep === '&')
    if (hasIntersection) {
      return intersectionOf(allTypes)
    }
    return unionOf(allTypes)
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
    // 环境回退：注解引用对象变量（匿名对象字面量）作为类型——soft typing，
    // JSON 标签联合无需 #type 别名即可直接引用（pet: cat | dog）。
    // 仅对象类型有效：值类型（number/string 等）不可当类型用。
    const varType = env?.lookup(n)
    if (varType && varType.kind === 'object') {
      return varType
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
    if (isCastExpression(e)) {
      // 类型断言：直接返回断言类型
      return this.resolveAnnotation(e.type, accept, undefined, env)
    }
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
    // 解析调用点显式类型参数
    const explicitTypeArgs = message.typeArgs?.length
      ? message.typeArgs.map((t) =>
          this.resolveAnnotation(t, accept, undefined, env),
        )
      : undefined
    return this.dispatch(receiver, name, argTypes, accept, message, explicitTypeArgs)
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
      case 'intersection':
        if (receiver.delegation) {
          // 委托交集：任一侧有方法即可，取第一个有的
          for (const sub of receiver.types) {
            const sigs = this.resolveSigs(sub, name)
            if (sigs) return sigs
          }
        } else {
          // 严格交集：第一个有该方法的成员的签名
          for (const sub of receiver.types) {
            const sigs = this.resolveSigs(sub, name)
            if (sigs) return sigs
          }
        }
        return undefined
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
    explicitTypeArgs?: TypeInfo[],
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
          this.dispatch(sub, name, args, accept, node, explicitTypeArgs),
        )
        if (results.some((r) => r.kind === 'any')) {
          return anyType
        }
        return unionOf(results)
      }
      case 'intersection': {
        if (receiver.delegation) {
          // 委托交集：任一侧有方法即可，取第一个有的
          for (const sub of receiver.types) {
            if (this.hasMethod(sub, name)) {
              return this.dispatch(sub, name, args, accept, node, explicitTypeArgs)
            }
          }
          return anyType
        }
        // 严格交集：所有成员都必须能响应此消息，签名必须兼容
        const withMethod = receiver.types.filter((t) =>
          this.hasMethod(t, name),
        )
        if (withMethod.length === 0) {
          return anyType
        }
        // 只有部分成员有该方法：需要判别后才能调用（类似联合语义）
        if (withMethod.length < receiver.types.length) {
          const without = receiver.types.filter(
            (t) => !this.hasMethod(t, name),
          )
          accept(
            'warning',
            `消息 '${name}' 只定义在部分交集成员上（${withMethod.map(describeType).join(' & ')}），${without.map(describeType).join(' & ')} 上没有，需要先判别`,
            { node, data: diagnosticData('partialIntersectionMessage') },
          )
          return anyType
        }
        // 所有成员都有：分别解析，检查签名兼容性
        const results = withMethod.map((sub) =>
          this.dispatch(sub, name, args, accept, node, explicitTypeArgs),
        )
        if (results.some((r) => r.kind === 'any')) {
          return anyType
        }
        // 检查所有返回类型是否兼容
        const [first, ...rest] = results
        for (const other of rest) {
          if (!isSubtype(first, other) && !isSubtype(other, first)) {
            accept(
              'error',
              `交集成员方法 '${name}' 返回类型不兼容：${describeType(first)} 与 ${describeType(other)}`,
              { node, data: diagnosticData('incompatibleIntersectionMethod') },
            )
            return anyType
          }
        }
        // 兼容：取所有返回类型的交集
        return intersectionOf(results)
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
          explicitTypeArgs,
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
          explicitTypeArgs,
        )
      case 'object': {
        const sigs = receiver.methods.get(name)
        if (!sigs) {
          return anyType
        }
        // withDefault 库签名（base 包 delegate）：返回委托交集（任一侧定义即可）
        if (name === 'withDefault' && args.length >= 2) {
          return intersectionOf(args, true)
        }
        return this.checkArgs(
          sigs,
          name,
          args,
          accept,
          node,
          receiver.name ? `对象类型 ${receiver.name}` : objectDesc,
          explicitTypeArgs,
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
      case 'intersection':
        if (t.delegation) {
          // 委托交集：任一侧有即可
          return t.types.some((sub) => this.hasMethod(sub, name))
        }
        // 严格交集：所有成员都必须有
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
    explicitTypeArgs?: TypeInfo[],
  ): TypeInfo {
    // 有显式类型参数：跳过推断，直接用显式参数实例化泛型签名
    if (explicitTypeArgs && explicitTypeArgs.length > 0) {
      // 先检查非泛型签名（带类型参数调用非泛型方法会告警）
      for (const sig of sigs) {
        if (!sig.typeParams && argsCompatible(sig, args)) {
          accept(
            'warning',
            `方法 '${name}' 不是泛型，不需要类型参数`,
            { node, data: diagnosticData('notGeneric') },
          )
          return sig.returns
        }
      }
      // 用显式类型参数实例化泛型签名
      for (const sig of sigs) {
        if (!sig.typeParams) {
          continue
        }
        if (sig.typeParams.length !== explicitTypeArgs.length) {
          accept(
            'warning',
            `类型 '${name}' 期望 ${sig.typeParams.length} 个类型参数，却给了 ${explicitTypeArgs.length} 个`,
            { node, data: diagnosticData('typeArgCount') },
          )
          continue
        }
        const inst = instantiateSigWithExplicitArgs(sig, explicitTypeArgs)
        if (argsCompatible(inst, args)) {
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

    // 无显式类型参数：原有推断逻辑
    // 可区分联合实参：分支感知推断——对 union 的每个成员分别找第一个匹配
    // 签名，返回各分支返回类型的联合（成员命中不同重载时比「取第一条」精确）。
    // 只在签名参数是对象/成员类型时启用；参数本身是 union 的签名保持原「整体匹配」。
    if (
      args.length > 0 &&
      args[0].kind === 'union' &&
      sigs.some(
        (s) => !s.typeParams && s.params[0] && s.params[0].kind === 'object',
      )
    ) {
      const branchReturns: TypeInfo[] = []
      for (const member of args[0].types) {
        let found: TypeInfo = anyType
        for (const sig of sigs) {
          if (sig.typeParams) {
            continue
          }
          if (argsCompatible(sig, [member, ...args.slice(1)])) {
            found = sig.returns
            break
          }
        }
        branchReturns.push(found)
      }
      return unionOf(branchReturns)
    }
    // 非泛型签名优先精确匹配
    for (const sig of sigs) {
      if (!sig.typeParams && argsCompatible(sig, args)) {
        return sig.returns
      }
    }
    // 方法泛型：map<T>(f: T -> U): U 从实参推断 T，实例化签名后匹配
    for (const sig of sigs) {
      if (!sig.typeParams) {
        continue
      }
      const inst = instantiateGenericSig(sig, args)
      if (argsCompatible(inst, args)) {
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
    if (isClassDef(e)) {
      // 内联类定义（非赋值）：只做签名收集，方法体在赋值处已检查
      const t: ObjectTypeInfo = { kind: 'object', methods: new Map() }
      const it: ObjectTypeInfo = { kind: 'object', methods: new Map() }
      for (const m of e.classMethods) {
        this.collectMethod(m, t, accept, env)
      }
      for (const m of e.instanceMethods) {
        this.collectMethod(m, it, accept, env)
      }
      const newSigs = t.methods.get('new')
      if (newSigs && newSigs.length > 0) {
        newSigs.forEach((s) => (s.returns = it))
      } else {
        t.methods.set('new', [{ params: [], returns: it }])
      }
      t.instanceType = it
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

  private unwrapClassDef(expr: Expression): ClassDef | undefined {
    if (!isMessageOrChain(expr) || expr.message) {
      return undefined
    }
    return this.unwrapClassPrimary(expr.primary)
  }

  private unwrapClassPrimary(p: Primary): ClassDef | undefined {
    if (isClassDef(p)) {
      return p
    }
    if (isComplexPrimary(p)) {
      if (isClassDef(p)) {
        return p
      }
      if (isPiplingExpression(p) || isMessageOrChain(p)) {
        return this.unwrapClassDef(p)
      }
    }
    return undefined
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
