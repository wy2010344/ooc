import type {
  ValidationAcceptor,
  ValidationChecks,
  ValidationSeverity,
} from 'langium'
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

  checkObjectDef(model: ObjectDef, accept: ValidationAcceptor): void {
    // 基本的模型验证逻辑
    // 可以在这里添加模型级别的验证
    const methodNames = new Set()
    model.methods.forEach((method) => {
      if (methodNames.has(method.name)) {
        this.wrap(accept)('error', `对象里已经定义了 '${method.name}'.`, {
          node: method,
          property: 'name',
          data: diagnosticData('duplicateMethod'),
        })
      }
      if (method.$type == 'MethodAll') {
        checkParamDuplicates(method, this.wrap(accept))
      }
      methodNames.add(method.name)
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
