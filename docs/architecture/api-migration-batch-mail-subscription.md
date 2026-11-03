# NeutralPress 邮件订阅后台读取 HTTP 化（2026-11-03）

工作区：ASUS `E:/NeutralPress`，分支 `feat/public-api-static-first`；未访问或修改生产数据库，未部署 Texas VPS。

## 迁移实现

- 完整十个邮件订阅 Action 实现下沉到 `lib/server/services/mail-subscription-domain.ts`，声明 `server-only`。原 `actions/mail-subscription.ts` 保留原函数签名作为兼容包装；未更改订阅确认、邮件发送、状态更新、清理等写入行为。
- 将 12 个原文件局部类型（状态、列表参数/数据、投递概览与结果）提取到 `lib/shared/mail-subscription-types.ts`，客户端及服务端均可使用类型，不再从 Action 文件引入共享类型。
- 新 API `/api/public/admin/mail-subscriptions/[operation]`。`overview` 与 `distribution` 为 GET；`list` 采用原生 **JSON POST**，因为 `search` 可能包含用户完整邮箱，禁止把订阅邮箱搜索词放进 GET URL、浏览器历史与代理日志。
- `lib/client/api/mail-subscription-read.ts` 适配器改为 `credentials:same-origin`，GET/POST 均使用 `cache:no-store`，支持 AbortSignal。
- 三个调用页面：`MailSubscriptionTable`、`MailSubscriptionDispatchPanel`、`PostEditorWrapper` 的读取从 Server Action 改为 HTTP 客户端；发送、清理、修改仍使用旧 Action。
- 所有接口仍由原服务校验 `ADMIN` 或 `EDITOR`，并执行原限流；HTTP 状态保留 401、429、400 等业务错误，统一 `Cache-Control:private,no-store`。`public` 是客户端可调用命名空间，**不是匿名读邮箱授权**。
- POST 请求沿用同源来源校验、JSON 请求体验证（最多 8 KiB）、严格字段白名单；列表页上限 200，每页最少 10，原业务内部会进一步做参数清洗。GET 聚合只接受空 `params`，拒绝 token 和其它查询字段。

## 验证

- 邮件订阅原业务 20/20 项测试通过；新 GET/POST 安全与客户端请求测试 7/7 通过。
- 联合回归 53 个测试文件、1127/1127 通过；Next.js 路由类型生成、Web TypeScript 检查、全 Web ESLint 0 警告通过。
- 对私密邮箱查询强制 POST、不缓存，也不将邮箱过滤条件放入 URL。确认订阅、退订、邮件投递等不可通过新增 GET/POST 读取接口触发。
- 尚未使用隔离数据库执行完整 Next.js 构建/浏览器实际操作；生产部署和 Cloudflare 缓存未动。

## 后续

- 核查 Cloud 同步、Security 等后台只读数据，避免向 URL 或 CDN 缓存泄露凭证。
- 优先精简兼容 Action 依赖并统一 JSON 传输、输入校验与权限上下文；再推进匿名 HTML 静态优先、按需失效 ISR。
