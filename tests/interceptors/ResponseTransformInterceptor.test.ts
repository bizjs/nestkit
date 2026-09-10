import { ExecutionContext } from '@nestjs/common';
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

  it('propagates errors without wrapping them as successful responses', async () => {
    const { context } = createContext(200);
    const error = new Error('failed');

    await expect(firstValueFrom(interceptor.intercept(context, {
      handle: () => throwError(() => error),
    }))).rejects.toBe(error);
  });
});
