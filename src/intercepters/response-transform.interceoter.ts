import { CallHandler, ExecutionContext, Injectable, NestInterceptor, StreamableFile } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, map } from 'rxjs';
import { REDIRECT_METADATA, SSE_METADATA } from '@nestjs/common/constants';
import { Stream } from 'node:stream';

@Injectable()
export class ResponseTransformInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    if (this.shouldSkipRoute(context)) {
      return next.handle();
    }

    return next.handle().pipe(
      map((value) => this.shouldSkipResponse(context, value) ? value : this.wrap(context, value)),
    );
  }

  private wrap(context: ExecutionContext, value: unknown) {
    const res = context.switchToHttp().getResponse<{ statusCode: number }>();
    return {
      success: true,
      statusCode: res.statusCode,
      data: value,
      message: 'ok',
    };
  }

  private shouldSkipRoute(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') {
      return true;
    }
    const handler = context.getHandler();
    const pureResponse = this.reflector.getAllAndOverride<boolean>('pureResponse', [handler, context.getClass()]);
    return Boolean(
      pureResponse ||
      this.reflector.get(SSE_METADATA, handler) ||
      this.reflector.get(REDIRECT_METADATA, handler),
    );
  }

  private shouldSkipResponse(context: ExecutionContext, value: unknown): boolean {
    const http = context.switchToHttp();
    const response = http.getResponse<HttpResponse>();
    return (
      http.getRequest<{ method: string }>().method === 'HEAD' ||
      this.isBodyUnavailable(response) ||
      this.isRawContent(response) ||
      this.isRawValue(value)
    );
  }

  private isBodyUnavailable(response: HttpResponse): boolean {
    const status = response.statusCode;
    return Boolean(
      response.headersSent || response.sent ||
      status < 200 || status === 204 || status === 205 ||
      (status >= 300 && status < 400),
    );
  }

  private isRawContent(response: HttpResponse): boolean {
    const disposition = String(response.getHeader?.('content-disposition') || '');
    if (/^attachment(?:;|$)/i.test(disposition)) {
      return true;
    }
    const contentType = String(response.getHeader?.('content-type') || '').split(';')[0].trim().toLowerCase();
    return Boolean(contentType) &&
      contentType !== 'application/json' &&
      !/^application\/[^;\s]+\+json$/.test(contentType);
  }

  private isRawValue(value: unknown): boolean {
    return (
      value === undefined ||
      !['object', 'string', 'number', 'boolean'].includes(typeof value) ||
      value instanceof StreamableFile || value instanceof Stream ||
      value instanceof ArrayBuffer || ArrayBuffer.isView(value)
    );
  }
}

interface HttpResponse {
  statusCode: number;
  headersSent?: boolean;
  sent?: boolean;
  getHeader?: (name: string) => unknown;
}
