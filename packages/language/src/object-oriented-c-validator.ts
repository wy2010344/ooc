import type { ValidationAcceptor, ValidationChecks } from 'langium'
import type {
  ObjectOrientedCAstType,
  OOCModel,
  ObjectLiteral,
  VarDeclaration,
  MethodMember,
  MethodParams,
} from './generated/ast.js'
import type { ObjectOrientedCServices } from './object-oriented-c-module.js'

/**
 * Register custom validation checks.
 */
export function registerValidationChecks(services: ObjectOrientedCServices) {
  const registry = services.validation.ValidationRegistry
  const validator = services.validation.ObjectOrientedCValidator
  const checks: ValidationChecks<ObjectOrientedCAstType> = {
    OOCModel: validator.checkModel,
    ObjectLiteral: validator.checkObjectMembers,
    VarDeclaration: validator.checkVariableDeclaration,
    MethodMember: validator.checkMethodMember,
    MethodParams: validator.checkMethodParams,
  }
  registry.register(checks, validator)
}

/**
 * Implementation of custom validations.
 */
export class ObjectOrientedCValidator {
  checkModel(model: OOCModel, accept: ValidationAcceptor): void {
    // Validate imports and exports at module level
    const exportedNames = new Set<string>()
    const importedNames = new Set<string>()

    for (const item of model.items) {
      if (item.$type === 'Export') {
        const name = item.varDecl?.name || item.methodDecl?.name
        if (name) {
          if (exportedNames.has(name)) {
            accept('error', `Duplicate export: ${name} is already exported`, {
              node: item,
            })
          } else {
            exportedNames.add(name)
          }
        }
      } else if (item.$type === 'Import') {
        const name = item.name
        if (name) {
          if (importedNames.has(name)) {
            accept('error', `Duplicate import: ${name} is already imported`, {
              node: item,
            })
          } else {
            importedNames.add(name)
          }
        }
      }
    }
  }

  checkObjectMembers(obj: ObjectLiteral, accept: ValidationAcceptor): void {
    // Check for duplicate member names in object
    const seenNames = new Set<string>()
    for (const member of obj.members) {
      const name = member.name
      if (name) {
        if (seenNames.has(name)) {
          accept('error', `Duplicate member name: ${name}`, { node: member })
        } else {
          seenNames.add(name)
        }
      }
    }
  }

  checkVariableDeclaration(
    decl: VarDeclaration,
    accept: ValidationAcceptor
  ): void {
    // Check variable names are not empty
    if (!decl.name || decl.name.trim().length === 0) {
      accept('error', 'Variable name cannot be empty', { node: decl })
      return
    }

    // Check that variable names start with lowercase
    if (decl.name && decl.name[0] === decl.name[0].toUpperCase()) {
      accept(
        'warning',
        `Variable name '${decl.name}' should start with lowercase`,
        { node: decl }
      )
    }

    // Ensure value is assigned
    if (!decl.value) {
      accept('error', `Variable ${decl.name} must have an assigned value`, {
        node: decl,
      })
    }
  }

  checkMethodMember(method: MethodMember, accept: ValidationAcceptor): void {
    // Check for duplicate parameters
    if (method.params && method.params.params) {
      const seenParams = new Set<string>()
      for (const param of method.params.params) {
        if (seenParams.has(param)) {
          accept('error', `Duplicate parameter: ${param}`, {
            node: method.params,
          })
        } else {
          seenParams.add(param)
        }
      }
    }
  }

  checkMethodParams(params: MethodParams, accept: ValidationAcceptor): void {
    // Check for duplicate parameters
    const seenParams = new Set<string>()
    for (const param of params.params) {
      if (seenParams.has(param)) {
        accept('error', `Duplicate parameter: ${param}`, {
          node: params,
        })
      } else {
        seenParams.add(param)
      }
    }
  }
}
