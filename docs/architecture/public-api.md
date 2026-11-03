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

## Phase 1 进展：server-only 服务层与后台统计 GET（2026-11-03）

上一节 Phase 0 中提及的「Route Handler 复用 Action」已由以下实现取代。**新的 /api/public/\* Route Handler 不再导入 actions 模块**；旧 Action 暂时保留为兼容适配。

| 路由                                                        | 业务层                                                     | 权限/缓存                                         | 客户端                                     |
| ----------------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------- | ------------------------------------------ |
| `GET /api/public/search?q=...`                              | `lib/server/services/search.ts`（全站搜索 + 文章全文搜索） | 匿名、原有限流、`private, no-store`               | SearchClient.tsx；GET + AbortController    |
| `GET /api/public/notifications/unread`                      | `lib/server/services/notice.ts`                            | 登录、角色校验、原有限流、`private, no-store`     | NotificationProvider + UnreadNoticeTracker |
| `GET /api/public/admin/search/index-stats?force=true`       | `lib/server/services/search-stats.ts`                      | ADMIN/EDITOR；原有权限及限流；`private, no-store` | 后台搜索索引、词云、仪表盘                 |
| `GET /api/public/admin/search/log-stats?days=30&force=true` | `lib/server/services/search-stats.ts`                      | ADMIN/EDITOR；天数限制 1–365；`private, no-store` | 搜索趋势、性能、搜索分析与仪表盘           |

- 服务层以 `import "server-only"` 明确仅在 Node.js 服务端运行，不能导入 `@/actions/*`。后续新增 API 仍按同一原则实现。
- 搜索参数与结果定义已移至 `lib/shared/search-site.ts`；用于 tsquery 语义安全的转义逻辑在 `lib/server/search-token.ts`，不再由 Action 独占。
- `actions/search.ts` 的 `searchPosts`、`searchSite`、`getSearchIndexStats`、`getSearchLogStats`，以及 `actions/notice.ts` 的 `getUnreadNoticeCount`，现为兼容包装，业务查询/授权实现只有一份。
- 8 个后台统计组件已改为浏览器原生 GET，词云页面中的 `Promise.all` 不再同时调用两个客户端 Server Functions；旧 Action 调用者仍然可用。
- 客户端统计 API 使用 `credentials: same-origin`、`cache: no-store`。即使属于 `/api/public/admin` 命名空间，也**不得在 CDN 进行共享缓存**。`force=true` 是在通过管理员/编辑认证后重新生成统计缓存，不授予任何写入业务数据的权限。
- 统计与全站搜索的旧业务函数包含统计缓存写入或检索遥测；GET 只读语义指业务状态，不保证无观测性副作用。后续可解耦异步搜索日志和更细粒度的流控。
- 已完成的验证：新增 4 个 Route Handler 的参数/鉴权状态测试与原搜索、通知 Action 兼容测试共 **89/89 通过**；`next typegen` 和 `tsc --noEmit` 通过；改动服务层及后台组件的 ESLint 问题已修复。
- 新增依赖边界测试 `src/app/api/public/__tests__/boundary.test.ts`，检查公开路由、客户端封装、服务层不引入 `actions`；远程执行曾被安全检查阻断，**本测试尚未标记为通过**，下轮需专门验证。
- 这是本地功能分支上的开发，不修改正式 VPS、DNS、Cloudflare 缓存规则。**整页 ISR / PPR 切换尚未实施**，应在 API 层充分验证后单独推进。
