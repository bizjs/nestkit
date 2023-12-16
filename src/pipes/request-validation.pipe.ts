import {
  ArgumentMetadata,
  Injectable,
  PipeTransform,
  BadRequestException,
} from '@nestjs/common';
import { validate } from 'class-validator';
import { plainToClass } from 'class-transformer';

@Injectable()
export class RequestValidationPipe implements PipeTransform {
  async transform(value: any, { metatype }: ArgumentMetadata) {
    if (!metatype || !this.toValidate(metatype)) {
      // 如果没有传入验证规则，则不验证，直接返回数据
      return value;
    }
    // 将对象转换为 Class 来验证
    const object: object = plainToClass(metatype, value);
    const errors = await validate(object);
    if (errors.length > 0) {
      // 拼接所有的异常
      const msg = errors
        .map((err) => {
          if (err.constraints) {
            return Object.values(err.constraints).join(',');
          }
          if (err.children?.length > 0) {
            return `property '${err.property}' invalid`;
          }
          return '';
        })
        .join('. ');

      throw new BadRequestException(`Validation failed: ${msg}`);
    }
    return value;
  }

  private toValidate(metatype: any): boolean {
    const types: any[] = [String, Boolean, Number, Array, Object];
    return !types.includes(metatype);
  }
}
