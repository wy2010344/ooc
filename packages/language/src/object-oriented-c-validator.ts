import type { ValidationAcceptor, ValidationChecks } from 'langium';
import type { ObjectOrientedCAstType, Person } from './generated/ast.js';
import type { ObjectOrientedCServices } from './object-oriented-c-module.js';

/**
 * Register custom validation checks.
 */
export function registerValidationChecks(services: ObjectOrientedCServices) {
    const registry = services.validation.ValidationRegistry;
    const validator = services.validation.ObjectOrientedCValidator;
    const checks: ValidationChecks<ObjectOrientedCAstType> = {
        Person: validator.checkPersonStartsWithCapital
    };
    registry.register(checks, validator);
}

/**
 * Implementation of custom validations.
 */
export class ObjectOrientedCValidator {

    checkPersonStartsWithCapital(person: Person, accept: ValidationAcceptor): void {
        if (person.name) {
            const firstChar = person.name.substring(0, 1);
            if (firstChar.toUpperCase() !== firstChar) {
                accept('warning', 'Person name should start with a capital.', { node: person, property: 'name' });
            }
        }
    }

}
