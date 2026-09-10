import { BadRequestException, ExecutionContext, HttpException, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { firstValueFrom, of, throwError } from 'rxjs';
import { PureResponse, ResponseTransformInterceptor } from '../../src';

describe('ResponseTransformInterceptor', () => {
  const interceptor = new ResponseTransformInterceptor(new Reflector());

  function createContext(statusCode: number, type = 'http', handler = () => {}) {
    const response = { statusCode };
    const switchToHttp = jest.fn(() => ({ getResponse: () => response, getRequest: () => ({ method: 'GET' }) }));
    const context = {
      getHandler: () => handler,
      getClass: () => class {},
      getType: () => type,
      switchToHttp,
    } as unknown as ExecutionContext;
    return { context, response, switchToHttp };
  }

  it.each([200, 201, 202, 206])('uses the HTTP response status %i', async (statusCode) => {
    const { context } = createContext(statusCode);
    const data = { id: 1 };

    await expect(firstValueFrom(interceptor.intercept(context, { handle: () => of(data) }))).resolves.toEqual({
      success: true,
      statusCode,
      data,
      message: 'ok',
    });
  });

  it('reads the status after the handler has executed', async () => {
    const { context, response } = createContext(200);
    const result = await firstValueFrom(interceptor.intercept(context, {
      handle: () => {
        response.statusCode = 202;
        return of('accepted');
      },
    }));

    expect(result.statusCode).toBe(202);
  });

  it('preserves responses marked with PureResponse', async () => {
    class Controller {
      @PureResponse()
      handler() {}
    }
    const { context, switchToHttp } = createContext(201, 'http', Controller.prototype.handler);
    const data = { id: 1 };

    await expect(firstValueFrom(interceptor.intercept(context, { handle: () => of(data) }))).resolves.toBe(data);
    expect(switchToHttp).not.toHaveBeenCalled();
  });

  it.each(['rpc', 'ws', 'graphql'])('preserves %s responses without accessing HTTP', async (type) => {
    const { context, switchToHttp } = createContext(200, type);
    const data = { id: 1 };

    await expect(firstValueFrom(interceptor.intercept(context, { handle: () => of(data) }))).resolves.toBe(data);
    expect(switchToHttp).not.toHaveBeenCalled();
  });

  it.each([
    [new BadRequestException('invalid'), 400, 'invalid'],
    [new BadRequestException(['field A invalid', 'field B missing']), 400, ['field A invalid', 'field B missing']],
    [new HttpException('unavailable', 503), 503, 'unavailable'],
  ])('wraps HTTP exceptions and sets the actual response status', async (error, statusCode, message) => {
    const { context, response } = createContext(201);
    const result = await firstValueFrom(interceptor.intercept(context, {
      handle: () => throwError(() => error),
    }));
    expect(result).toEqual({ success: false, statusCode, data: null, message });
    expect(response.statusCode).toBe(statusCode);
  });

  it('logs unexpected errors without exposing their details', async () => {
    const { context, response } = createContext(200);
    const error = new Error('internal database credentials');
    const log = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    try {
      expect(await firstValueFrom(interceptor.intercept(context, {
        handle: () => throwError(() => error),
      }))).toEqual({ success: false, statusCode: 500, data: null, message: 'Internal server error' });
      expect(response.statusCode).toBe(500);
      expect(log).toHaveBeenCalledWith(error);
    } finally { log.mockRestore(); }
  });

  it('propagates errors for PureResponse routes', async () => {
    class Controller {
      @PureResponse()
      handler() {}
    }
    const { context } = createContext(200, 'http', Controller.prototype.handler);
    const error = new BadRequestException();
    await expect(firstValueFrom(interceptor.intercept(context, {
      handle: () => throwError(() => error),
    }))).rejects.toBe(error);
  });

  it('does not change the status or swallow errors after headers are sent', async () => {
    const { context, response } = createContext(200);
    Object.assign(response, { headersSent: true });
    const error = new Error('stream failed');
    await expect(firstValueFrom(interceptor.intercept(context, {
      handle: () => throwError(() => error),
    }))).rejects.toBe(error);
    expect(response.statusCode).toBe(200);
  });
});
