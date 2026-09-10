import { ExecutionContext, Redirect, Render, Sse, StreamableFile } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Readable } from 'node:stream';
import { firstValueFrom, of } from 'rxjs';
import { PureResponse, ResponseTransformInterceptor } from '../../src';

const interceptor = new ResponseTransformInterceptor(new Reflector());
function run(value: unknown, options: { status?: number; method?: string; headers?: Record<string, string>; handler?: Function; controller?: Function; sent?: boolean; headersSent?: boolean } = {}) {
  const context = {
    getType: () => 'http',
    getHandler: () => options.handler || (() => {}),
    getClass: () => options.controller || class {},
    switchToHttp: () => ({
      getRequest: () => ({ method: options.method || 'GET' }),
      getResponse: () => ({ statusCode: options.status || 200, sent: options.sent, headersSent: options.headersSent, getHeader: (name: string) => options.headers?.[name] }),
    }),
  } as unknown as ExecutionContext;
  return firstValueFrom(interceptor.intercept(context, { handle: () => of(value) }));
}

describe('response wrapping boundaries', () => {
  it('preserves template locals before HTML headers are set, even with wrapping enabled', async () => {
    class Controller {
      @Render('index') page() {}
      @PureResponse(false)
      @Render('index') explicitlyWrapped() {}
    }
    const locals = { title: 'Welcome' };
    for (const handler of [Controller.prototype.page, Controller.prototype.explicitlyWrapped]) {
      expect(await run(locals, { handler, controller: Controller })).toBe(locals);
    }
  });

  it.each([204, 205, 301, 302, 304, 307, 308])('preserves status %i payloads', async (status) => {
    const value = { url: '/next' };
    expect(await run(value, { status })).toBe(value);
  });

  it('preserves HEAD and already sent responses', async () => {
    const value = { id: 1 };
    expect(await run(value, { method: 'HEAD' })).toBe(value);
    expect(await run(value, { sent: true })).toBe(value);
    expect(await run(value, { headersSent: true })).toBe(value);
  });

  it.each(['text/plain', 'text/html', 'text/event-stream', 'application/octet-stream'])('preserves %s payloads', async (type) => {
    expect(await run('raw payload', { headers: { 'content-type': type } })).toBe('raw payload');
  });

  it('preserves JSON downloads', async () => {
    const value = { id: 1 };
    expect(await run(value, { headers: { 'content-disposition': 'attachment; filename="data.json"' } })).toBe(value);
  });

  it('preserves files, streams, binary and absent values', async () => {
    const stream = Readable.from(['data']);
    try {
      for (const value of [new StreamableFile(Buffer.from('file')), stream, Buffer.from('data'), new Uint8Array([1]), new ArrayBuffer(1), undefined]) {
        expect(await run(value)).toBe(value);
      }
    } finally {
      stream.destroy();
    }
  });

  it.each([null, false, 0, '', [1], { id: 1 }])('wraps JSON values: %j', async (value) => {
    expect(await run(value)).toEqual({ success: true, statusCode: 200, data: value, message: 'ok' });
  });

  it.each(['application/json; charset=utf-8', 'application/vnd.api+json'])('wraps %s', async (type) => {
    expect(await run({ id: 1 }, { headers: { 'content-type': type } })).toHaveProperty('data', { id: 1 });
  });

  it('preserves SSE and redirect payloads before headers or status are set', async () => {
    class Controller {
      @Sse() events() {}
      @Redirect('/next') redirect() {}
    }
    for (const handler of [Controller.prototype.events, Controller.prototype.redirect]) {
      const value = { url: '/dynamic', data: 'event' };
      expect(await run(value, { handler })).toBe(value);
    }
  });

  it('inherits controller PureResponse and allows method overrides', async () => {
    @PureResponse()
    class Controller {
      inherited() {}
      @PureResponse(false) wrapped() {}
      @PureResponse(false)
      @Sse() events() {}
    }
    const value = { id: 1 };
    expect(await run(value, { controller: Controller, handler: Controller.prototype.inherited })).toBe(value);
    expect(await run(value, { controller: Controller, handler: Controller.prototype.wrapped })).toHaveProperty('data', value);
    expect(await run(value, { controller: Controller, handler: Controller.prototype.events })).toBe(value);
  });

  it('lets a method opt out when its controller enables wrapping', async () => {
    @PureResponse(false)
    class Controller {
      @PureResponse() raw() {}
    }
    const value = { id: 1 };
    expect(await run(value, { controller: Controller, handler: Controller.prototype.raw })).toBe(value);
  });
});
