# NestKit Session

基于 [expressjs/session](https://github.com/expressjs/session) 改造的 TypeScript Session 中间件，通过 `@bizjs/nestkit` 的 `expressSession` 导出使用。会话数据保存在服务端，客户端仅携带随机 SID。

- [上游 README](https://github.com/expressjs/session/blob/master/README.md)
- [上游许可证](https://github.com/expressjs/session/blob/master/LICENSE)
- [NestJS 官方 Session 文档](https://docs.nestjs.com/techniques/session)

本文描述当前仓库实现；上游文档用于了解原始设计，不能直接套用其中所有选项。此处不声明与上游最新版本完全兼容。

## 相对原版的改动

| 项目            | 当前实现                                                                             |
| --------------- | ------------------------------------------------------------------------------------ |
| 实现与分发      | TypeScript 源码，通过 NestKit 子路径导出；Vite Library 构建 ESM、CommonJS 和类型声明 |
| 关闭 Cookie     | `cookie: false` 禁用 session Cookie 读写与路径匹配，不影响应用的其他 Cookie          |
| 自定义 SID 来源 | `getid(req, sessionIdName)` 从 Header 等位置读取原始 SID；配置后不再回退读取 Cookie  |
| SID 生成        | 内部使用 `crypto.randomBytes(24).toString('base64url')`，移除 `genid` 自定义选项     |
| Cookie 签名     | 移除签名、验签及 `secret` 选项，Cookie 直接携带 SID；不解码旧签名 Cookie             |
| Cookie 名称     | 仅保留 `name`，默认 `connect.sid`；移除 `key` 别名                                   |
| 旧字段兼容      | 不从 `req.cookies`、`req.signedCookies` 读取 SID                                     |
| 原生能力        | 随机数、Buffer、调试日志使用 Node.js 内置能力；路径解析直接截掉查询字符串            |
| 测试            | 上游测试迁移到 TypeScript + Vitest，并增加 Header 和禁用 Cookie 的用例               |

路径解析面向 `/path?query` 形式的常规 HTTP 请求目标，不解析完整代理 URL，也不规范化原始路径。Cookie 路径匹配当前仍使用前缀判断。

`@bizjs/nestkit` 根入口的 `syncSessionIdFromHeader`、`getSignedSessionId` 是为原始 `express-session` 提供的独立适配工具。它们仍保留签名能力；使用本实现时直接配置 `getid`，无需这些工具。

## 在 NestJS 中使用 Header SID

以下用法适用于 NestJS 的 Express 适配器。中间件直接通过 `app.use()` 注册，无需额外封装 Nest 模块，也不需要 `cookie-parser` 或签名密钥。

### 1. 注册中间件

在 `main.ts` 中，于 `listen()` 之前注册：

```ts
import { NestFactory } from '@nestjs/core';
import { expressSession } from '@bizjs/nestkit';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.use(
    expressSession({
      cookie: false,
      getid(req) {
        const sid = req.headers['x-session-id'];
        return typeof sid === 'string' ? sid : undefined;
      },
      store: new expressSession.MemoryStore(),
      resave: false,
      touchInterval: 5 * 60 * 1000,
      saveUninitialized: false,
    }),
  );

  await app.listen(3000);
}

void bootstrap();
```

`MemoryStore` 用于演示和本地开发，数据保存在当前进程，重启会丢失。需要持久化时换成项目自己的 Store；Nest provider 可通过 `app.get(DatabaseSessionStore)` 获取后传入 `store`。

Node.js 请求头名称为小写，因此读取 `req.headers['x-session-id']`。后续示例通过响应 JSON 返回 SID，中间件不会自动生成 SID 响应头，也不会写入 session `Set-Cookie`。

### 2. 使用 @Session() 读写会话

NestJS 的 `@Session()` 直接注入 `req.session`，可用于读写会话和调用会话方法。当前 SID 可从 `session.id` 或 `req.sessionID` 获取。修改会话后，中间件会在响应结束前自动保存，通常无需主动调用 `save()`。

以下控制器假设项目已有 `AuthService` 和 `LoginDto`：`AuthService.validate()` 校验凭据，成功时返回含 `id` 的用户，失败时抛出认证异常。请替换为项目现有认证逻辑，并在 AppModule 注册控制器及服务。

```ts
import { Body, Controller, Get, Post, Req, Session, UnauthorizedException } from '@nestjs/common';
import type { HttpSessionRequest, SessionInstance } from '@bizjs/nestkit';
import { AuthService } from './services/auth.service';
import { LoginDto } from './dtos/login.dto';

interface AuthSession {
  userId?: string;
  role?: string;
}

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  async login(@Body() dto: LoginDto, @Session() session: SessionInstance<AuthSession>, @Req() req: HttpSessionRequest) {
    const user = await this.authService.validate(dto);

    // 登录成功后换一个 SID，随后从 req.sessionID 读取新值。
    await new Promise<void>((resolve, reject) => {
      session.regenerate((error) => (error ? reject(error) : resolve()));
    });

    // regenerate 替换了会话对象，必须读取 req.session 中的新实例。
    const currentSession = req.session! as SessionInstance<AuthSession>;
    currentSession.userId = user.id;
    currentSession.cookie.maxAge = 24 * 60 * 60 * 1000;

    return { sid: currentSession.id };
  }

  @Get('me')
  me(@Session() session: SessionInstance<AuthSession>) {
    const userId = session.userId;
    if (userId == null) throw new UnauthorizedException();
    return { userId };
  }

  @Post('logout')
  async logout(@Session() session: SessionInstance<AuthSession>) {
    await new Promise<void>((resolve, reject) => {
      session.destroy((error) => (error ? reject(error) : resolve()));
    });
    return { success: true };
  }
}
```

`req.session.cookie` 在 Header 模式下仍保留，用于服务端过期时间计算，不代表会生成浏览器 Cookie。示例中的 `maxAge` 单位是毫秒。

`@Session()` 来自 `@nestjs/common`；会话类型 `SessionInstance` 从 `@bizjs/nestkit` 根入口导出，可直接使用，避免与装饰器重名。通过 `SessionInstance<AuthSession>` 声明业务字段；不传泛型时仍可使用动态字段。业务字段不要与 `id`、`cookie`、`save` 等内置成员重名，未登录时可能缺失的字段声明为可选。示例假设用户 ID 为字符串，可按项目实际类型调整。

登录示例同时使用 `@Req()`，因为 `regenerate()` 会替换 `req.session`，而已注入的 `session` 参数仍指向旧对象。普通读写不需要 `@Req()`。

`saveUninitialized: false` 时，只读取 SID 不会自动持久化未修改的新会话；写入用户信息后会自动保存。只有需要等待保存结果并在控制器中处理保存错误时，才显式调用 `save(callback)`。注销后客户端也应丢弃本地 SID。

### 3. 客户端携带 Header

```ts
const loginResponse = await fetch('/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username, password }),
});
if (!loginResponse.ok) throw new Error('登录失败');
const { sid } = await loginResponse.json();

const meResponse = await fetch('/auth/me', {
  headers: { 'X-Session-Id': sid },
});
const me = await meResponse.json();

await fetch('/auth/logout', {
  method: 'POST',
  headers: { 'X-Session-Id': sid },
});
```

示例使用 Nest 默认响应格式。若项目启用了响应包装拦截器，按实际响应结构读取 `sid`。跨域访问时，在应用的 CORS 配置中允许 `X-Session-Id` 请求头。

SID 是访问会话的凭证，应通过 HTTPS 传输，避免写入 URL 和日志。

## SID 读取和过期行为

- 配置 `getid` 后，返回的字符串作为 Store 查询键；返回空值时直接创建新会话，不回退 Cookie。
- SID 缺失、未知或已过期时，生成新的随机 SID，不沿用客户端提供的未知值。存在 `req.session` 不代表已经登录，应检查其中的身份字段。
- `getid` 抛出的异常传给 `next(error)`。
- 关闭 Cookie 且未配置 `getid` 时，每次请求都会创建新会话。
- Header 模式默认没有过期时间，创建会话时可设置 `req.session.cookie.maxAge`。
- `touchInterval` 设置未修改会话的最小续期间隔，单位毫秒，默认 `0`（每次请求都可续期）。示例设为 `5 * 60 * 1000`，需配合 `resave: false`。
- 间隔内未修改的会话不调用 Store `touch`，也不自动推进内存中的过期时间；到达间隔后，下一次请求才续期。Cookie 模式下即使 `rolling: true` 仍发送 Cookie，间隔内的过期时间也不会推进。
- 会话数据有修改时立即保存并刷新过期时间，不受间隔限制；显式 `save()` 同样不受限制。判断依据是会话数据，不是 GET/POST 方法。
- 通过 Store 中的 `cookie.expires - cookie.originalMaxAge` 推算上次续期，不增加额外字段。Store 的 `touch` 必须同步持久化 Cookie 过期元数据；只更新外部 TTL 的 Store 无法持续按该间隔节流。没有可推算的过期元数据时保持每次请求可续期。
- 间隔应小于 `maxAge`。正常按请求续期时，相比每次访问都续期，会话可能提前最多约一个间隔失效；已过期的会话不会被重新续期。并发请求可能同时触发续期，该配置不提供跨请求锁。
- `rolling` 控制响应 Cookie 的刷新；关闭 Cookie 后，它不控制 Header 返回，也不提供续期限流。

## Cookie 模式

如果客户端使用 Cookie，省略 `getid` 并提供 Cookie 选项即可：

```ts
app.use(
  expressSession({
    name: 'connect.sid',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: true, // HTTPS 环境；本地 HTTP 开发时设为 false。
      maxAge: 24 * 60 * 60 * 1000,
    },
  }),
);
```

Cookie 中保存原始随机 SID，无需 `secret`。旧签名 Cookie 不会恢复旧会话。

## Header 优先，缺失时读取 Cookie

在 `getid` 内显式实现回退。此示例保持 Cookie 开启，因此满足写入条件时仍会发送 session `Set-Cookie`。

示例使用 `cookie` 包解析请求头；应用直接引用时将它加入自己的依赖：`pnpm add cookie`。

```ts
import { expressSession } from '@bizjs/nestkit';
import { parse } from 'cookie';

const sessionIdName = 'x-sid';
app.use(
  expressSession({
    name: sessionIdName,
    getid(req, name) {
      const sid = req.headers[name.toLowerCase()];
      if (typeof sid === 'string' && sid) return sid;

      const cookies = req.headers.cookie;
      return cookies ? parse(cookies)[name] : undefined;
    },
    resave: false,
    saveUninitialized: false,
    touchInterval: 5 * 60 * 1000,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: true, // HTTPS 环境；本地 HTTP 开发时设为 false。
      maxAge: 24 * 60 * 60 * 1000,
    },
  }),
);
```

- Header 和 Cookie 共用配置的 `name`；本例请求头为 `x-sid: <sid>`。有非空字符串 Header SID 时优先使用 Header，即使同时携带 Cookie。
- Header 缺失或为空：读取名为 `x-sid` 的 Cookie；两者都没有则创建新会话。
- Header SID 未知或已过期：创建新会话，不再尝试 Cookie。回退判断的是 Header 是否提供值，不是 Store 查询是否成功。

`getid` 的第二个参数是中间件解析后的 Cookie 名称，未配置时为 `connect.sid`，Header 读取使用 `name.toLowerCase()`，Cookie 读取使用原始 `name`。当前示例默认使用 MemoryStore，需要持久化时传入项目的 Store。

## 配置选项

| 选项                | 默认值             | 说明                                                                                          |
| ------------------- | ------------------ | --------------------------------------------------------------------------------------------- |
| `cookie`            | 默认 Cookie 配置   | 配置对象、按请求返回配置的函数，或 `false`                                                    |
| `getid`             | 未设置             | `getid(req, sessionIdName)` 自定义读取 SID，第二个参数是实际 Cookie 名称                      |
| `name`              | `connect.sid`      | Session Cookie 名称                                                                           |
| `store`             | 新建 `MemoryStore` | 会话存储                                                                                      |
| `resave`            | `true`             | 是否保存未修改的会话；示例显式设为 `false`                                                    |
| `touchInterval`     | `0`                | 未修改会话的最小续期间隔（毫秒），建议配合 `resave: false` 和 `maxAge`                        |
| `saveUninitialized` | `true`             | 是否保存新建且未修改的会话；示例显式设为 `false`                                              |
| `rolling`           | `false`            | 是否每次响应都刷新 session Cookie                                                             |
| `proxy`             | 未设置             | 是否信任 `X-Forwarded-Proto`；未设置时使用 Express 的 `req.secure` 判断，TLS 连接直接判为安全 |
| `unset`             | `keep`             | 清空 `req.session` 时保留还是销毁 Store 数据                                                  |

## Store 与常用方法

导出的 `Store` 定义 `get`、`set`、`destroy`，并可实现 `touch`。数据中需保留 `cookie` 过期元数据，持久化 Store 应负责过期判断及清理。第三方 Store 的类型和过期行为需要按实际实现核对。

| 方法 / 字段                        | 用途                                                     |
| ---------------------------------- | -------------------------------------------------------- |
| `req.sessionID`                    | 当前 SID                                                 |
| `req.session`                      | 会话数据及操作方法                                       |
| `req.session.save(callback)`       | 显式保存                                                 |
| `req.session.regenerate(callback)` | 销毁旧会话并生成新 SID；回调成功后重新读取 `req.session` |
| `req.session.reload(callback)`     | 从 Store 重新加载                                        |
| `req.session.destroy(callback)`    | 销毁会话                                                 |
| `req.session.touch()`              | 重置内存中的过期时间，不直接写入 Store                   |

## 本地测试与构建

在 NestKit 项目根目录执行：

```sh
pnpm test                         # 全部测试，包含 session
pnpm test express-session         # 仅 session 测试
pnpm test express-session --coverage --coverage.include="src/express-session/**/*.ts"
pnpm build
```

测试位于 `tests/express-session/`，直接加载源码，无需预先构建。HTTPS 测试读取 fixtures 中的证书；手动重新生成：

```sh
sh tests/express-session/fixtures/gencert.sh
```

调试日志使用 Node.js `debuglog`，通过 `NODE_DEBUG=express-session` 开启。
