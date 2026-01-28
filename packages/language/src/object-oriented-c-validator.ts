import type { ValidationAcceptor, ValidationChecks } from 'langium'
import type { ObjectOrientedCAstType, ObjectDef } from './generated/ast.js'
import type { ObjectOrientedCServices } from './object-oriented-c-module.js'

/**
 * Register custom validation checks.
 */
export function registerValidationChecks(services: ObjectOrientedCServices) {
  const registry = services.validation.ValidationRegistry
  const validator = services.validation.ObjectOrientedCValidator
  const checks: ValidationChecks<ObjectOrientedCAstType> = {
    ObjectDef: validator.checkObjectDef,
  }
  registry.register(checks, validator)
}

/**
 * Implementation of custom validations.
 */
export class ObjectOrientedCValidator {
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
        const reported = new Set()
        method.params.forEach((param) => {
          if (reported.has(param.name)) {
            accept('error', `参数里已经定义了 '${param.name}'.`, {
              node: param,
              property: 'name',
            })
          }
          reported.add(param.name)
        })
      }
      methodNames.add(method.name)
    })
  }
}
