import { URI } from 'langium'
import type { ValidationAcceptor, ValidationChecks, ValidationSeverity } from 'langium'
import { isModel } from './generated/ast.js'
import type {
  ObjectOrientedCAstType,
  ObjectDef,
  LambdaDef,
  MethodAll,
} from './generated/ast.js'
import type { ObjectOrientedCServices } from './object-oriented-c-module.js'
import {
  createImportResolver,
  ObjectOrientedCTypeChecker,
} from './type-checker.js'
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
    Model: validator.checkModel,
  }
  registry.register(checks, validator)
}

/**
 * Implementation of custom validations.
 */
export class ObjectOrientedCValidator {
  private config: OocConfig | undefined

  constructor(private readonly services?: ObjectOrientedCServices) {}

  setConfig(config: OocConfig | undefined): void {
    this.config = config
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
    new ObjectOrientedCTypeChecker(importResolver).checkModel(
      model,
      this.wrap(accept),
    )
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
      }
    })
  }

  checkLambdaDef(lambda: LambdaDef, accept: ValidationAcceptor): void {
    checkParamDuplicates(lambda, this.wrap(accept))
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
