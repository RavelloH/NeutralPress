# NeutralPress Public API 分层约定

重构分支：`feat/public-api-static-first`。参考 InsightFlare 的 `routes/public` 与 `routes/private`。本文件记录本次第一阶段已经实现和准备迁移的接口分类，**并非对所有现有 Route Handlers 的行为变更**。

## 路径语义与权限

- `/api/public/*`：客户端可以直接请求的、稳定的 API 接口面。**public 仅代表对外可访问，绝不意味着无需认证。** 按端点区分 `anonymous`、`authenticated`、`admin/editor`。即使属于 public 命名空间，涉及用户、管理员或写入的接口仍执行服务端会话、角色、CSRF/Origin、速率限制、权限校验。
- `/api/private/*` 与既有 `/internal/*`：仅受信任的内部运行时、后台任务、鉴权回调或者服务间消息使用，保留原有安全控制；不能因想归类 API 就创建可绕过认证的 public 别名。
- `/api/v1/*`：未来需要版本化且对外承诺兼容时再建立，不在本阶段机械迁移。
- 已有 `/feed.xml`、`/feed.json`、`/p/:id`、`/social-image/*`、SSO 等 URL 为页面链接、第三方回调或公开媒体入口；先保留兼容，后续可以在内部实现层复用 public API，不以重构为由修改其 URL。

## Phase 0 已添加

| Method | Path                               | 权限                                                | Cache-Control       | 实现状态                                                                      |
| ------ | ---------------------------------- | --------------------------------------------------- | ------------------- | ----------------------------------------------------------------------------- |
| GET    | `/api/public/search?q=...`         | anonymous，沿用原搜索限流；限制 q 为 1–200 字符     | `private, no-store` | 已新增；搜索客户端使用 fetch + AbortController，旧 Server Action 暂时保留兼容 |
| GET    | `/api/public/notifications/unread` | authenticated，沿用原 ACCESS_TOKEN + 角色鉴权与限流 | `private, no-store` | 已新增；通知组件改用 GET，未登录仍返回 401                                    |

说明：搜索会话 ID 和访客 ID 放在同源请求头 `x-search-session-id`、`x-search-visitor-id`，不放入 URL；并复用原有业务函数、日志与限流，避免双份 SQL。GET 无需序列化排队，取消可以停止浏览器继续等待旧响应；服务端正在执行的数据库查询不保证会被立即取消。搜索日志属于访问遥测写入，需要在后续业务服务层重构中解耦。

## 既有 Route Handler 的分类清单（旧 URL 暂不变）

| 当前 URL                                              | 分组                                | 说明                                      |
| ----------------------------------------------------- | ----------------------------------- | ----------------------------------------- |
| `/feed.xml`、`/feed.json`                             | public / anonymous                  | 公开订阅内容                              |
| `/p/:id`、`/social-image/*`                           | public / anonymous                  | 公开/签名媒体资源，继续校验签名及访问策略 |
| `/r/:token`                                           | public / sensitive token            | 一次性短链接；不允许 CDN 公开缓存         |
| `/sso/:provider/login`、`/sso/:provider/callback`     | public / sensitive auth             | SSO/OAuth 交互；保留状态/回调和安全校验   |
| `/admin/media/upload`                                 | public-facing / authenticated admin | 写入操作；路径保留，严禁匿名化            |
| `/admin/cloud/trigger`                                | private/inbound webhook             | 云侧触发鉴权，保留原入口与签名校验        |
| `/internal/runtime/init`、`/internal/cache/bootstrap` | private/internal                    | 系统初始化与缓存刷新，绝不创建匿名别名    |

> “API 都归类 public”在实施中适用于**客户端对外 API 的组织层**，不包括内部接口强行降权；也不要求把所有历史 URL 立即改变。下一阶段新读接口优先放入 `/api/public/*`，旧路径兼容层在验证后逐步转发/复用，而不是重复业务代码。

## 后续优先级

1. 将搜索业务 SQL、索引和日志从 `actions/search.ts` 拆到 server-only Service；Action 和 GET Handler 只作薄适配，统一错误/鉴权/请求上下文。
2. 按领域迁移频繁读取的评论、文章列表、图库、统计、管理查询，优先减少单页连续多个 Server Actions；需要登录的 GET 带 `credentials: same-origin` 且不共享缓存。
3. 写入动作保留 Server Actions 或逐步改 Mutation API；保持请求签名、登录态、权限、限流和审计，避免 GET 直接产生业务写操作。
4. 渲染分支单独推进整页 ISR、按需重新验证和 Cloudflare 缓存命中；先让匿名页面真正完整静态化，再部署 CDN 缓存规则。
5. 测试：输入长度边界、401/403、限流、Cookie/缓存隔离、GET 客户端取消与请求并发、旧入口回归和真实数据库副本联调。

## 实施注意

- Next.js 16 `cacheComponents: true` 不会自动保证整个 HTML 静态可缓存；不要只把 `cacheComponents` 改为 `false` 而未迁移 `use cache` 体系。
- 开发机 `E:/NeutralPress` 与 Texas VPS 生产部署隔离。本分支在通过本地检查和验收前不直接推送/部署，也不复制线上环境变量到仓库。
