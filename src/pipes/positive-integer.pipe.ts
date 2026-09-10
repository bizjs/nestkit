import {
  ArgumentMetadata,
  Injectable,
  PipeTransform,
  BadRequestException,
} from '@nestjs/common';

@Injectable()
export class PositiveIntegerPipe implements PipeTransform<unknown, number> {
  transform(value: unknown, { data }: ArgumentMetadata): number {
    const validType = typeof value === 'number' ||
      (typeof value === 'string' && /^[0-9]+$/.test(value));
    const numVal = validType ? Number(value) : NaN;

    const isPositiveInteger = Number.isSafeInteger(numVal) && numVal > 0;

    if (!isPositiveInteger) {
      throw new BadRequestException(
        `Validation failed: ${data ? `'${data}'` : 'value'} must be a positive safe integer.`
      );
    }

    return numVal;
  }
}
