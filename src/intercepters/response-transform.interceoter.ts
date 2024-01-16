import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, map } from 'rxjs';

@Injectable()
export class ResponseTransformInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const pureResponse = this.reflector.get<boolean>('pureResponse', context.getHandler());

    return next.handle().pipe(
      map((value) => {
        const contextType = context.getType();
        // ignore not http request
        if (contextType !== 'http') {
          return value;
        }

        if (pureResponse === true) {
          return value;
        }
        return {
          success: true,
          statusCode: 200,
          data: value,
          message: 'ok',
        };
      }),
    );
  }
}
