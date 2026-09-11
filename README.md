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
pnpm install --frozen-lockfile
pnpm build
pnpm test
```

## Publishing

Update the version and changelog, then manually run **Publish to npm** in GitHub
Actions on the branch to publish. The workflow installs dependencies, builds and
publishes. It uses npm Trusted Publishing (OIDC), without `NODE_AUTH_TOKEN` or an
npm token secret. Node.js 24 provides a compatible npm CLI (11.5.1 or later).

Configure the GitHub Actions trusted publisher once in the npm settings for
`@bizjs/nestkit`:

- Organization or user: `bizjs`
- Repository: `nestkit`
- Workflow filename: `npm-publish.yml`
- Environment: leave empty
- Allow direct publishing with `npm publish`

See [npm's trusted publishing documentation](https://docs.npmjs.com/trusted-publishers/).
After the first successful OIDC publication, the old publishing token can be revoked.

For local publishing, authenticate with `npm login`, then run `pnpm run pub`.
This builds and publishes without running tests automatically. To preview the
package locally, run `pnpm build` followed by `npm pack --dry-run`.
JavaScript, `.d.ts` declarations, source maps and documentation are included;
TypeScript incremental build caches are excluded.

## Response wrapping

Register `ResponseTransformInterceptor` through Nest dependency injection (for
example, with `APP_INTERCEPTOR`). Ordinary JSON responses use
`{ success: true, statusCode, data, message: 'ok' }`, with the current HTTP status.

Controller and pipe exceptions reaching this interceptor use
`{ success: false, statusCode, data: null, message }`. `HttpException` status codes
and messages (including validation message arrays) are preserved. Unexpected
errors are logged and return HTTP 500 with `Internal server error`.
Guard failures, unmatched routes and request-body parsing errors occur outside
this interceptor and retain their existing exception handling.

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
the handler. For excluded routes/responses, errors propagate unchanged to Nest
exception handling.

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

RedisLock uses the `redis` v5 client. Its first operation explicitly connects;
concurrent first operations share that pending connection. A completed or failed
connection attempt is not cached, so a later call can connect again after failure.
Automatic reconnection uses up to three retries per connection cycle, with a
5-second connection-attempt timeout. Commands have no separate timeout; an
unresponsive connection may leave commands pending until it closes or `close()`
is called.
Operations wait for a pending connection/reconnection, but fail if it reports an
error. Offline command queuing is disabled, so a disconnect between readiness
and command dispatch fails the command instead of delaying it. A failed command
does not guarantee that Redis never executed it. Use `onError` to customize
connection-error reporting (defaults to `console.error`).

`await redisLock.close()` immediately destroys the connection and rejects pending
commands instead of waiting for their replies. Release
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

## Wrapped memory cache

Pass one async loader directly; it receives the cache key and returns its value.
`ttl` and `refreshThreshold` are in milliseconds.

```ts
const cache = new WrappedMemoryCache({
  ttl: 10000,
  refreshThreshold: 3000,
  refreshFn: async (key) => fetchProject(key),
  onRefreshError: (key, error) => console.error(key, error),
});

const project = await cache.getCachedValue('project1');
await cache.delCachedValue('project1');
```

Migration: replace `refreshFn: key => () => load(key)` with
`refreshFn: key => load(key)` (or `refreshFn: load`). Background refresh failure
preserves the existing value until its original expiry; a failed initial load
returns `undefined`.

## Redis sessions (connect-redis v9)

Session storage now uses `connect-redis` v9 and the `redis` v5 client. The
application owns the connection. `createRedisStore` now accepts a client instead
of a URL; pass `connectionName` as `name` when creating that client.

```ts
import { createClient } from 'redis';
import session = require('express-session');
import { createRedisStore } from '@bizjs/nestkit';

const client = createClient({
  url: process.env.REDIS_URL,
  name: 'session',
});
client.on('error', console.error);
await client.connect();

const store = createRedisStore(client, { prefix: 'myapp:sess:' });
app.use(session({
  store,
  secret: process.env.SESSION_SECRET!,
  resave: false,
  saveUninitialized: false,
}));
```

Install `express-session` in the consuming application. In its owning provider's
shutdown hook, after requests have drained, use `await client.close()` for normal
shutdown (`client.destroy()` for forced disconnection). The store neither
connects nor closes the supplied client. Use separate Lock and Session clients
so closing a lock instance does not close the session connection. Applications
may also use `new RedisStore({ client, prefix })` directly.
