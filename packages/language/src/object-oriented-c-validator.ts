import { URI } from 'langium'
import type { ValidationAcceptor, ValidationChecks, ValidationSeverity } from 'langium'
import { isModel } from './generated/ast.js'
import type {
  ObjectOrientedCAstType,
  ObjectDef,
  LambdaDef,
  MethodAll,
  Method,
  ClassDef,
} from './generated/ast.js'
import type { ObjectOrientedCServices } from './object-oriented-c-module.js'
import { getMethodName } from './completion-type-utils.js'
import {
  createImportResolver,
  ObjectOrientedCTypeChecker,
} from './type-checker.js'
import type { TypeInfo } from './type-system.js'
import { diagnosticData, filterDiagnostic, type OocConfig } from './diagnostics-config.js'
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
    ClassDef: validator.checkClassDef,
    Model: validator.checkModel,
  }
  registry.register(checks, validator)
}

/**
 * Implementation of custom validations.
 */
export class ObjectOrientedCValidator {
  private config: OocConfig | undefined
  private globalsTypes: Map<string, TypeInfo> | undefined

  constructor(private readonly services?: ObjectOrientedCServices) {}

  setConfig(config: OocConfig | undefined): void {
    this.config = config
  }

  setGlobalsTypes(types: Map<string, TypeInfo> | undefined): void {
    this.globalsTypes = types
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
      this.globalsTypes,
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

  checkClassDef(model: ClassDef, accept: ValidationAcceptor): void {
    // 类方法与实例方法块都检查参数重名
    ;[...model.classMethods, ...model.instanceMethods].forEach((method) => {
      if (method.$type == 'MethodAll') {
        checkParamDuplicates(method, this.wrap(accept))
      }
    })
    checkOverloadRules(model.classMethods, this.wrap(accept), '类方法')
    checkOverloadRules(model.instanceMethods, this.wrap(accept), '实例方法')
  }
}

/**
 * 重载语义检查：
 * 1. 同名方法必须相邻连续（重载分支聚在一起，中间不能隔其它名字的方法）。
 * 2. guard 只在重载组内起作用：单方法带 guard、非末尾分支缺 guard、末尾分支带 guard 均报错。
 *    重载组 = 同名的实现方法块；guard 分支 = 显式守卫，末尾分支 = 无条件兜底。
 */
function checkOverloadRules(
  methods: Method[],
  accept: ValidationAcceptor,
  kind: string,
): void {
  // 同名方法必须相邻：末尾出现同名但上一条不是同名 → 报错
  const lastPosition = new Map<string, number>()
  methods.forEach((method, i) => {
    if (method.$type !== 'MethodAll') {
      return
    }
    const n = getMethodName(method)
    if (!n) {
      return
    }
    const prev = lastPosition.get(n)
    if (prev !== undefined && prev !== i - 1) {
      accept(
        'error',
        `${kind}里同名方法 '${n}' 的重载分支必须聚在一起（相邻连续），中间插了其它名字的方法`,
        { node: method, property: 'name', data: diagnosticData('overloadNotAdjacent') },
      )
    }
    lastPosition.set(n, i)
  })

  // 按名字收集实现方法块（MethodAll with body）
  const groups = new Map<string, MethodAll[]>()
  methods.forEach((method) => {
    if (method.$type !== 'MethodAll' || !method.body) {
      return
    }
    const n = getMethodName(method)
    if (!n) {
      return
    }
    const g = groups.get(n)
    if (g) {
      g.push(method)
    } else {
      groups.set(n, [method])
    }
  })

  for (const [n, group] of groups) {
    const last = group[group.length - 1]
    // 多分支重载组：末尾分支是无条件兜底，不能带 guard
    if (group.length > 1 && last.body?.guardExpression) {
      accept(
        'error',
        `方法 '${n}' 的重载末尾分支是无条件兜底，不能带 #guard（前面的守卫分支对不上时会落入这里）`,
        { node: last, property: 'name', data: diagnosticData('guardOnTrailingBranch') },
      )
    }
    // 单方法（组里只有 1 个实现）：guard 只在重载组里起作用
    if (group.length === 1 && last.body?.guardExpression) {
      accept(
        'error',
        `方法 '${n}' 只有单个分支，不能带 #guard（guard 只在多分支重载组里起作用）`,
        { node: last, property: 'name', data: diagnosticData('guardOnlyInOverload') },
      )
    }
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
