import {
  registerDecorator,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

@ValidatorConstraint({ async: false })
class IsPositiveIntegerStringConstraint
  implements ValidatorConstraintInterface
{
  validate(value: unknown) {
    if (typeof value !== 'string' || !/^[0-9]+$/.test(value)) {
      return false;
    }
    const numVal = Number(value);
    return Number.isSafeInteger(numVal) && numVal > 0;
  }
}

export function IsPositiveIntegerString(validationOptions?: ValidationOptions) {
  return function (object: unknown, propertyName: string) {
    registerDecorator({
      target: object.constructor,
      propertyName: propertyName,
      options: {
        message: `${propertyName} must be a positive safe integer string`,
        ...validationOptions,
      },
      constraints: [],
      validator: IsPositiveIntegerStringConstraint,
    });
  };
}
