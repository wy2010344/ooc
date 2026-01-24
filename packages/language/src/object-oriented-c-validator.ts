import type { ValidationAcceptor, ValidationChecks } from 'langium'
import type { ObjectOrientedCAstType, Model } from './generated/ast.js'
import type { ObjectOrientedCServices } from './object-oriented-c-module.js'

/**
 * Register custom validation checks.
 */
export function registerValidationChecks(services: ObjectOrientedCServices) {
  const registry = services.validation.ValidationRegistry
  const validator = services.validation.ObjectOrientedCValidator
  const checks: ValidationChecks<ObjectOrientedCAstType> = {
    Model: validator.checkModel,
  }
  registry.register(checks, validator)
}

/**
 * Implementation of custom validations.
 */
export class ObjectOrientedCValidator {
  checkModel(model: Model, accept: ValidationAcceptor): void {
    // 基本的模型验证逻辑
    // 可以在这里添加模型级别的验证
    if (!model.expression) {
      accept('error', 'Model must have an expression', { node: model })
    }
  }
}
