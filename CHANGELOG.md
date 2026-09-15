## 1.1.0

### Added

- Add a TypeScript session middleware based on `expressjs/session`, exported as `expressSession`, with generic `SessionInstance<T>` for application fields and NestJS `@Session()` usage.
- Support `cookie: false` to disable session Cookie transport, and `getid(req, name)` to read a SID from headers or implement explicit Header-to-Cookie fallback.
- Add `touchInterval` in milliseconds to reduce renewal writes for unchanged sessions. The default is `0`; modified sessions and explicit saves are not throttled.
- Document NestJS setup, login/logout, SID retrieval, Cookie and Header examples, and differences from upstream.
- Add session transport and renewal-interval regression tests alongside the migrated upstream session suite.

### Changed

- Generate session IDs internally with Node.js `crypto.randomBytes(24)` and base64url encoding. The new middleware omits upstream `genid`, `secret`, Cookie signing, and the `key` alias; use `name` for the Cookie name.
- Use native Node.js utilities for session randomness, Buffer operations, and debug logging. Extract session helpers and simplify request-path parsing.
- Replace Jest with Vitest and V8 coverage. Run all tests with `pnpm test`, or select session tests with `pnpm test express-session`.
- Replace the TypeScript-only build with Vite Library, emitting CommonJS, ESM, source maps, and declarations. Configure Oxc decorator metadata for tests and update package exports and dependencies.

### Notes

- The new middleware does not decode upstream signed cookies; clients carrying them start a new session. Existing `syncSessionIdFromHeader` and `getSignedSessionId` helpers remain available for the original `express-session` package.
- Use `touchInterval` with `resave: false` and an interval shorter than the session lifetime. Throttling relies on persisted `cookie.expires` and `cookie.originalMaxAge`; stores that only update an external TTL cannot maintain this interval across requests.
- An unchanged session may expire up to approximately one interval earlier than with per-request renewal. Concurrent requests may still renew together.

## 1.0.0

### Breaking changes

- Replace `ioredis` with `redis` v5 and upgrade `connect-redis` from v8 to v9. The Redis dependency requires Node.js 18.19.0 or later; also satisfy the requirements of your Nest version.
- Change `createRedisStore(redisUrl, options)` to `createRedisStore(client, { prefix })`. Pass a `redis` client or cluster and manage its connection, error listener and shutdown in the application. Move `connectionName` to the client's `name` option.
- Simplify `WrappedMemoryCache.refreshFn` from `(key) => () => Promise<value>` to `(key) => Promise<value>`.
- Remove `RequestValidationPipe`. Use `ValidationPipe` from `@nestjs/common` and configure transformation and whitelist behavior explicitly. Validation error messages may differ.
- Restrict `PositiveIntegerPipe` to positive safe integer numbers or digit-only strings. `IsPositiveIntegerString` now accepts digit-only strings only. Both reject values above `Number.MAX_SAFE_INTEGER`, whitespace, signs, decimal/scientific notation and other coercible input types. Leading zeros remain supported. Direct calls to `PositiveIntegerPipe.transform()` now return a number synchronously.
- Require `RedisLock.acquireLock()` TTL values to be positive safe integers in seconds. Invalid values reject with `RangeError` before connecting.
- Use the actual HTTP status in wrapped responses instead of a fixed `200`. Exceptions reaching an eligible response interceptor now return `{ success: false, statusCode, data: null, message }`; clients relying on Nest's previous error body should update their handling.

### Added

- Add `RedisLock.close()` to terminate the connection and reject pending commands. Repeated calls share the shutdown result; further lock operations reject. Release held locks before closing if they should not remain until TTL expiry.
- Add `RedisLock.onError` for connection-error reporting.
- Support controller-level `@PureResponse()` and method overrides with `@PureResponse(false)`.
- Preserve `HttpException` status codes and message arrays in error responses. Log unexpected exceptions and return HTTP 500 with `Internal server error` without exposing their details.

### Fixed

- Make lock renewal atomic and owner-checked with Lua, preventing an expired lock handle from extending a different owner's lock.
- Use UUID owner tokens for Redis locks.
- Connect RedisLock on its first operation, share concurrent connection attempts and allow recovery after an initial connection failure. Bound automatic reconnection retries and disable offline command queuing.
- Preserve cached values and their original expiration when a background loader throws. Failed initial loads continue to return `undefined`.
- Avoid response wrapping for `@Render()`, `@Sse()`, redirects, HEAD, 204/205 and 3xx responses, already sent responses, files, streams, binary data, undefined values, downloads and explicit non-JSON content types.
- Normalize configured Session request-header names to lowercase.

### Migration examples

```ts
// Request validation
import { ValidationPipe } from '@nestjs/common';
app.useGlobalPipes(new ValidationPipe());

// Memory cache loader
const cache = new WrappedMemoryCache({
  ttl: 10000,
  refreshThreshold: 3000,
  refreshFn: key => load(key),
});

// Application-owned Session connection
import { createClient } from 'redis';
const client = createClient({ url: process.env.REDIS_URL, name: 'session' });
client.on('error', console.error);
await client.connect();
const store = createRedisStore(client, { prefix: 'app:sess:' });
// After requests have drained, close this client in the application's shutdown hook.
await client.close();
```

### Notes

- Exception wrapping is implemented in `ResponseTransformInterceptor`; no additional exception filter is required. Guard failures, unmatched routes and request-body parsing errors remain outside its scope. Errors on excluded routes/responses continue through Nest's exception handling.
- Cache deletion does not cancel in-flight loads or refreshes. Background refreshes that cross TTL expiry can still race with new loads.
- Redis commands have no independent timeout. Closing the lock client interrupts pending operations, but does not release held locks. Lock acquisition and renewal do not account for TTL consumed while waiting for a delayed reply.
- Update the package license declaration from ISC to MIT, usage documentation and regression tests.

## 0.6.0 (2025-07-02)

- `WrappedMemoryCache` support delete cached value

## 0.5.0 (2025-03-28)

- Support reading session ID from the header to enable session authentication under CORS.

## 0.4.1 (2024-12-19)

- Fix the issue with the abnormal build result directory.

## 0.4.0 (2024-12-19)

- Add `WrappedMemoryCache` for advanced cache.
- Add more tests

## 0.3.0 (2024-11-11)

- Introduce `RedisLock` for distributed locking.

## 0.2.3 (2024-03-01)

- Fix roles check error

## 0.2.2 (2024-03-01)

- Fix roles check error

## 0.2.1 (2024-02-22)

- Add tea.yaml

## 0.2.0 (2024-01-16)

- transform response only match http request

## 0.1.1 (2023-12-16)

- Rename interface `RolesGuardConfig` to `IRolesGuardConfig`

## 0.1.0 (2023-12-16)

- Support dynamic inject service to get user roles
- The first beta version

## 0.0.2 (2023-12-16)

- Add common functions for nest.js
