import type { ValidationChecks } from 'langium';
import type { ObjectOrientedCAstType } from './generated/ast.js'
import type { ObjectOrientedCServices } from './object-oriented-c-module.js'

/**
 * Register custom validation checks.
 */
export function registerValidationChecks(services: ObjectOrientedCServices) {
  const registry = services.validation.ValidationRegistry
  const validator = services.validation.ObjectOrientedCValidator
  const checks: ValidationChecks<ObjectOrientedCAstType> = {
    // Add custom validation checks here
  }
  registry.register(checks, validator)
}

/**
 * Implementation of custom validations.
 */
export class ObjectOrientedCValidator {
  // Add custom validation methods here
}
