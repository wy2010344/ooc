import type { ValidationAcceptor, ValidationChecks } from 'langium'
import type {
  ObjectOrientedCAstType,
  ObjectDef,
  LambdaDef,
  MethodAll,
} from './generated/ast.js'
import type { ObjectOrientedCServices } from './object-oriented-c-module.js'
import { ObjectOrientedCTypeChecker } from './type-checker.js'

/**
 * Register custom validation checks.
 */
export function registerValidationChecks(services: ObjectOrientedCServices) {
  const registry = services.validation.ValidationRegistry
  const validator = services.validation.ObjectOrientedCValidator
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
  checkModel(
    model: Parameters<ObjectOrientedCTypeChecker['checkModel']>[0],
    accept: ValidationAcceptor,
  ): void {
    // 每次新建，避免不同文档之间的类型定义互相污染
    new ObjectOrientedCTypeChecker().checkModel(model, accept)
  }

  checkObjectDef(model: ObjectDef, accept: ValidationAcceptor): void {
    // 基本的模型验证逻辑
    // 可以在这里添加模型级别的验证
    const methodNames = new Set()
    model.methods.forEach((method) => {
      if (methodNames.has(method.name)) {
        accept('error', `对象里已经定义了 '${method.name}'.`, {
          node: method,
          property: 'name',
        })
      }
      if (method.$type == 'MethodAll') {
        checkParamDuplicates(method, accept)
      }
      methodNames.add(method.name)
    })
  }

  checkLambdaDef(lambda: LambdaDef, accept: ValidationAcceptor): void {
    checkParamDuplicates(lambda, accept)
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
      })
    }
    reported.add(param.name)
  })
  if (owner.$type === 'MethodAll' && owner.restParam) {
    if (reported.has(owner.restParam.name)) {
      accept('error', `参数里已经定义了 '${owner.restParam.name}'.`, {
        node: owner.restParam,
        property: 'name',
      })
      reported.add(owner.restParam.name)
    }
  }
}
