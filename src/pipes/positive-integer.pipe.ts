import {
  ArgumentMetadata,
  Injectable,
  PipeTransform,
  BadRequestException,
} from '@nestjs/common';

@Injectable()
export class PositiveIntegerPipe implements PipeTransform {
  async transform(value: any, { data }: ArgumentMetadata): Promise<number> {
    const numVal = Number(value);

    const isPositiveInteger = Number.isInteger(numVal) && numVal > 0;

    if (!isPositiveInteger) {
      throw new BadRequestException(
        `Validation failed: '${data}' must be positive integer.`
      );
    }

    return numVal;
  }
}
