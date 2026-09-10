# nestkit

A toolkit package for nest.js

## Get started

### Request validation

Use `ValidationPipe` directly from `@nestjs/common`. The previous NestKit
`RequestValidationPipe` export has been removed.

```ts
import { ValidationPipe } from '@nestjs/common';

app.useGlobalPipes(new ValidationPipe());
```

Enable `transform: true` to pass transformed DTO instances to handlers. Configure
`whitelist` and `forbidNonWhitelisted` as needed. The official pipe's default error
messages and handling of edge cases differ from the removed implementation;
review clients that depend on validation error formatting.

## Develop

```bash
# Install deps
pnpm i

# Build
pnpm build

# Publish
pnpm run pub
```

## Response wrapping

Register `ResponseTransformInterceptor` through Nest dependency injection (for
example, with `APP_INTERCEPTOR`). Ordinary JSON responses use
`{ success: true, statusCode, data, message: 'ok' }`, with the current HTTP status.

`@PureResponse()` skips wrapping. It works on controllers and methods; a method's
setting takes precedence over its controller's setting:

```ts
@PureResponse()
@Controller('items')
export class ItemsController {
  @Get('raw')
  raw() {
    return { id: 1 }; // Returned unchanged
  }

  @PureResponse(false)
  @Get('wrapped')
  wrapped() {
    return { id: 1 }; // Wrapped in the standard response envelope
  }
}
```

The interceptor automatically preserves non-HTTP responses, `@Sse()` and
`@Redirect()` and `@Render()` responses, HEAD requests, 204/205 and 3xx responses, sent responses,
`StreamableFile`, Node streams, binary data, and `undefined`. Downloads marked
with `Content-Disposition: attachment` and explicit non-JSON content types are
also preserved. `application/json` and `application/*+json` are eligible for
wrapping. Without a content type, ordinary values (including strings, arrays,
DTO objects and `null`) are eligible. Set the content type or use `@PureResponse()`
for raw text or other custom formats. `@PureResponse(false)` does not override
these automatic exclusions. Direct `@Res().send()` responses remain managed by
the handler. Errors propagate unchanged.

## Positive integers

`PositiveIntegerPipe` accepts numbers or decimal digit strings and returns a
number synchronously. Values must be between `1` and `Number.MAX_SAFE_INTEGER`
(inclusive). Leading zeros are accepted (`"0012"` becomes `12`); whitespace,
explicit signs, decimal points, scientific notation, and non-decimal string
formats are rejected. Booleans, arrays, objects, and bigint values are rejected.

`@IsPositiveIntegerString()` applies the same range and format rules but accepts
strings only. These stricter rules replace the previous permissive numeric
coercion. Keep identifiers above the safe integer limit as strings and use a
separate string validator. Numeric inputs are checked as received: precision or
format information already lost during JSON parsing cannot be recovered.

## Redis lock lifecycle

Call `await redisLock.close()` after all lock operations have finished. Release
held locks before closing: closing the connection does not delete locks; any
unreleased locks remain until their TTL expires. Repeated calls share the same
shutdown result. Acquire, release, and renewal operations reject after closing.

```ts
const redisLock = new RedisLock({ redisUrl: 'redis://localhost:6379' });
try {
  const lock = await redisLock.acquireLock('job', 30);
  if (lock) {
    try {
      await doWork();
    } finally {
      await lock.release();
    }
  }
} finally {
  await redisLock.close();
}
```

In Nest applications, call `close()` from the owning provider's shutdown hook.
