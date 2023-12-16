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
    const numVal = Number(value);
    return Number.isInteger(numVal) && numVal > 0;
  }
}

export function IsPositiveIntegerString(validationOptions?: ValidationOptions) {
  return function (object: unknown, propertyName: string) {
    registerDecorator({
      target: object.constructor,
      propertyName: propertyName,
      options: {
        message: `${propertyName} must be a positive integer string`,
        ...validationOptions,
      },
      constraints: [],
      validator: IsPositiveIntegerStringConstraint,
    });
  };
}
