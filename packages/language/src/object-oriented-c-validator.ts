import type { ValidationAcceptor, ValidationChecks } from 'langium'
import type {
  ObjectOrientedCAstType,
  OOCModel,
  ObjLit,
  ObjItem,
  VarDecl,
  Item,
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
    ObjLit: validator.checkObjectMembers,
    ObjItem: validator.checkMethodParameters,
    VarDecl: validator.checkVariableDeclaration,
    Item: validator.checkItemDeclaration,
  }
  registry.register(checks, validator)
}

/**
 * Implementation of custom validations.
 */
export class ObjectOrientedCValidator {
  checkModel(model: OOCModel, accept: ValidationAcceptor): void {
    // Validate imports and exports
    const exportedNames = new Set<string>()
    const importedNames = new Set<string>()

    for (const item of model.items) {
      if (item.$type === 'Export' && item.decl) {
        const name =
          item.decl.$type === 'VarDecl' ? item.decl.name : item.decl.name
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

  checkObjectMembers(obj: ObjLit, accept: ValidationAcceptor): void {
    // Check for duplicate member names in object
    const seenNames = new Set<string>()
    for (const item of obj.items) {
      const name = item.name
      if (name) {
        if (seenNames.has(name)) {
          accept('error', `Duplicate member name: ${name}`, { node: item })
        } else {
          seenNames.add(name)
        }
      }
    }
  }

  checkMethodParameters(objItem: ObjItem, accept: ValidationAcceptor): void {
    // Validate method parameter names are unique (only for items with params)
    if (objItem.params) {
      const paramNames = new Set<string>()
      for (const param of objItem.params.params) {
        if (paramNames.has(param)) {
          accept('error', `Duplicate parameter name: ${param}`, {
            node: objItem,
          })
        } else {
          paramNames.add(param)
        }
      }
    }
  }

  checkVariableDeclaration(decl: VarDecl, accept: ValidationAcceptor): void {
    // Check variable names follow naming conventions (optional but good practice)
    // Variables should not be empty
    if (!decl.name || decl.name.trim().length === 0) {
      accept('error', 'Variable name cannot be empty', { node: decl })
    }

    // Warn about uppercase variable names (should be lowercase)
    if (decl.name && /^[A-Z]/.test(decl.name)) {
      accept('warning', 'Variable names should start with lowercase letter', {
        node: decl,
        property: 'name',
      })
    }

    // Ensure value is assigned
    if (!decl.value) {
      accept('error', `Variable ${decl.name} must have an assigned value`, {
        node: decl,
      })
    }
  }

  checkItemDeclaration(item: Item, accept: ValidationAcceptor): void {
    // Additional checks for items at module level
    if (item.$type === 'Export') {
      if (!item.decl) {
        accept('error', 'Export must have a declaration', { node: item })
      }
    } else if (item.$type === 'Import') {
      if (!item.filepath) {
        accept('error', 'Import must specify a file path', { node: item })
      }
      if (!item.name) {
        accept('error', 'Import must have a name', { node: item })
      }
    }
  }
}
