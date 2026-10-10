import { URI } from 'langium'
import type { ValidationAcceptor, ValidationChecks, ValidationSeverity } from 'langium'
import { isModel } from './generated/ast.js'
import type {
  ObjectOrientedCAstType,
  ObjectDef,
  LambdaDef,
  MethodAll,
  Method,
} from './generated/ast.js'
import type { ObjectOrientedCServices } from './object-oriented-c-module.js'
import { getMethodName } from './completion-type-utils.js'
import {
  createImportResolver,
  ObjectOrientedCTypeChecker,
} from './type-checker.js'
import type { TypeInfo } from './type-system.js'
import {
  diagnosticData,
  filterDiagnostic,
  mergeGlobalsTypes,
  type OocConfig,
} from './diagnostics-config.js'
import { resolveModuleName } from './module-path.js'

/**
 * Register custom validation checks.
 */
export function registerValidationChecks(
  services: ObjectOrientedCServices,
  config?: OocConfig,
) {
  const registry = services.validation.ValidationRegistry
  const validator = services.validation.ObjectOrientedCValidator
  if (config) {
    validator.setConfig(config)
  }
  const checks: ValidationChecks<ObjectOrientedCAstType> = {
    ObjectDef: validator.checkObjectDef,
    LambdaDef: validator.checkLambdaDef,
    Model: validator.checkModel,
  }
  registry.register(checks, validator)
}

/**
 * Implementation of custom validations.
 */
export class ObjectOrientedCValidator {
  private config: OocConfig | undefined
  /** 宿主注入的全局类型注册表（Route A：从宿主包 .ooc 类型源加载），构造时设一次，不被 per-doc 覆盖 */
  private registry: Map<string, TypeInfo> | undefined
  /** 当前有效的全局类型（= 注册表 ∪ 本项目 config.ooc 收集的 globals），供 checkModel 读取 */
  private globalsTypes: Map<string, TypeInfo> | undefined

  constructor(private readonly services?: ObjectOrientedCServices) {}

  setConfig(config: OocConfig | undefined): void {
    this.config = config
  }

  /** 设置全局类型注册表（宿主注入）：同时作为初始的有效全局类型 */
  setRegistry(types: Map<string, TypeInfo> | undefined): void {
    this.registry = types
    if (this.globalsTypes === undefined) {
      this.globalsTypes = types
    }
  }

  /** 覆盖有效全局类型（仅 per-doc 项目 globals 合并结果），不影响注册表 */
  setGlobalsTypes(types: Map<string, TypeInfo> | undefined): void {
    this.globalsTypes = types
  }

  /**
   * 注入本项目 config.ooc 收集的项目 globals：合并到注册表之上作为本次校验
   * 的有效全局类型。注册表保持不动，多文档之间不会串（#2 修复：以前直接
   * 覆盖 globalsTypes，会污染后续 collectConfigGlobals 的解析基准）。
   */
  applyGlobals(docGlobals: Map<string, TypeInfo> | undefined): void {
    this.globalsTypes = mergeGlobalsTypes(this.registry, docGlobals)
  }

  /** 注入的全局桥接类型（供 shared checker 的 hover/补全等只读场景复用） */
  getGlobalTypes(): Map<string, TypeInfo> | undefined {
    return this.globalsTypes
  }

  private wrap(accept: ValidationAcceptor): ValidationAcceptor {
    return (severity, message, info) => {
      const code =
        info.data && typeof info.data === 'object' && 'code' in info.data
          ? (info.data as { code?: string }).code
          : undefined
      const next = filterDiagnostic(this.config, severity, code)
      if (next === undefined) {
        return
      }
      accept(next as ValidationSeverity, message, info)
    }
  }

  checkModel(
    model: Parameters<ObjectOrientedCTypeChecker['checkModel']>[0],
    accept: ValidationAcceptor,
  ): void {
    this.checkCircularImports(model, accept)
    // 每次新建，避免不同文档之间的类型定义互相污染。
    // 有 services 时注入 #import 解析器：跨模块 typedef/模块结果类型可见（需要完整工作区）。
    const importResolver = this.services
      ? createImportResolver(
          this.services.shared.workspace.LangiumDocuments,
          this.services.LanguageMetaData.fileExtensions,
        )
      : undefined
    new ObjectOrientedCTypeChecker(importResolver, this.globalsTypes).checkModel(
      model,
      this.wrap(accept),
    )
  }

  /** 收集 config.ooc Model 的 globals 成员类型（供 LSP/CLI 注入全局类型） */
  collectConfigGlobals(
    model: Parameters<ObjectOrientedCTypeChecker['checkModel']>[0],
  ): Map<string, TypeInfo> | undefined {
    const importResolver = this.services
      ? createImportResolver(
          this.services.shared.workspace.LangiumDocuments,
          this.services.LanguageMetaData.fileExtensions,
        )
      : undefined
    return new ObjectOrientedCTypeChecker(
      importResolver,
      this.registry,
    ).collectConfigGlobals(model)
  }

  /** 在已加载工作区中深度优先检查 #import 环，环上的导入语句各自报告一次。 */
  private checkCircularImports(
    model: Parameters<ObjectOrientedCTypeChecker['checkModel']>[0],
    accept: ValidationAcceptor,
  ): void {
    if (!this.services || !model.$document) return
    const documents = this.services.shared.workspace.LangiumDocuments
    const extensions = this.services.LanguageMetaData.fileExtensions
    const rootPath = model.$document.uri.path
    const visited = new Set<string>()
    const visiting: string[] = []

    const visit = (current: typeof model, currentPath: string): void => {
      if (visited.has(currentPath)) return
      visited.add(currentPath)
      visiting.push(currentPath)
      for (const statement of current.expressions) {
        if (statement.$type !== 'ImportStatement') continue
        const importedPath = resolveModuleName(
          statement.path,
          currentPath,
          extensions,
        )
        const cycleStart = visiting.indexOf(importedPath)
        if (cycleStart !== -1) {
          const chain = [...visiting.slice(cycleStart), importedPath]
          this.wrap(accept)('error', `不允许循环模块导入：${chain.join(' -> ')}`, {
            node: statement,
            property: 'path',
            data: diagnosticData('circularImport'),
          })
          continue
        }
        const imported = documents.getDocument(URI.file(importedPath))
        const importedModel = imported?.parseResult.value
        if (isModel(importedModel)) {
          visit(importedModel, importedPath)
        }
      }
      visiting.pop()
    }

    visit(model, rootPath)
  }

  checkObjectDef(model: ObjectDef, accept: ValidationAcceptor): void {
    // 检查方法参数重名
    model.methods.forEach((method) => {
      if (method.$type == 'MethodAll') {
        checkParamDuplicates(method, this.wrap(accept))
        // 签名方法（无 body）必须声明返回类型，否则是悬空的垃圾写法
        if (!method.body && !method.returnType) {
          this.wrap(accept)(
            'error',
            `签名方法 '${getMethodName(method)}' 必须声明返回类型：name(...): Type`,
            { node: method, property: 'name' },
          )
        }
      }
    })
    checkOverloadRules(model.methods, this.wrap(accept), '对象')
  }

  checkLambdaDef(lambda: LambdaDef, accept: ValidationAcceptor): void {
    checkParamDuplicates(lambda, this.wrap(accept))
  }
}

/**
 * 方法名唯一性检查：#guard 改成方法体内的分支语句后不再有「同名重载」，
 * 同一个对象里同名**实现**（有 body）重复定义直接报错（否则后定义静默覆盖前定义）。
 * 签名方法（无 body）是纯类型契约，与实现同名合法，不算重复。
 */
function checkOverloadRules(
  methods: Method[],
  accept: ValidationAcceptor,
  kind: string,
): void {
  const seen = new Set<string>()
  for (const method of methods) {
    if (method.$type !== 'MethodAll') {
      continue
    }
    const n = getMethodName(method)
    if (!n) {
      continue
    }
    // 签名方法（无 body）：只作类型声明，不与实现冲突
    if (!method.body) {
      continue
    }
    if (seen.has(n)) {
      accept(
        'error',
        `${kind}里方法 '${n}' 重复定义（#guard 是方法体内的分支语句，不再有同名重载；分支请写在同一个方法体里）`,
        { node: method, property: 'name', data: diagnosticData('duplicateMethod') },
      )
      continue
    }
    seen.add(n)
  }
}

/** 检查参数重名（lambda 与 MethodAll 共用） */
function checkParamDuplicates(
  owner: MethodAll | LambdaDef,
  accept: ValidationAcceptor,
): void {
  const reported = new Set<string>()
  owner.params.forEach((param) => {
    if (reported.has(param.name)) {
      accept('error', `参数里已经定义了 '${param.name}'.`, {
        node: param,
        property: 'name',
        data: diagnosticData('duplicateParam'),
      })
    }
    reported.add(param.name)
  })
  if (owner.$type === 'MethodAll' && owner.restParam) {
    if (reported.has(owner.restParam.name)) {
      accept('error', `参数里已经定义了 '${owner.restParam.name}'.`, {
        node: owner.restParam,
        property: 'name',
        data: diagnosticData('duplicateParam'),
      })
      reported.add(owner.restParam.name)
    }
  }
}
