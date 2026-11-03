# NeutralPress Analytics：客户端 HTTP API 解耦（2026-11-03）

本地分支：`feat/public-api-static-first`，ASUS 路径 `E:/NeutralPress`；未部署 Texas VPS，未用生产数据库 build。

## 迁移

- 将 `actions/analytics.ts` 的五项导出实现完整下沉至 `lib/server/services/analytics-domain.ts`，加 `server-only`；原 Action 保存兼容函数签名、返回类型和错误处理。
- `trackPageView` 访客追踪从客户端 Server Action 改为 `/api/public/analytics/track` JSON POST。保留原有 Redis 5 秒去重、UA/IP/机器人识别、速率限制、落库事件队列。最多 4 KiB、严格 Zod 输入、同源请求检查。
- 后台 `getAnalyticsStats`、`getPageViews`、`getRealTimeStats` 改为 `/api/public/admin/analytics/{summary,pages,realtime}` JSON POST。由于 Stats 和 Realtime 原服务在读取前 `flushEventsToDatabase()`，**不能把它们错误标记为纯 GET 或公开缓存**；全部 `private,no-store`，保留 ADMIN 验证。
- `batchGetViewCounts` 原生 GET `/api/public/analytics/view-counts?params=...`，保持 Redis-only、匿名限流、每次最多 20 个路径，封装层转换为原来的裸数组 `[{path,count}]`。
- `lib/client/api/analytics-read.ts` 同源请求、`credentials:same-origin`、`cache:no-store`、`AbortSignal`。服务端接收前剔除访问令牌，避免隐私信息出现在 URL/请求 JSON。
- 新增通用 `lib/server/api-json-post.ts`：JSON 内容类型、Host/Origin/Sec-Fetch-Site 来源验证、body 字节限制与 access_token 拒绝。公用 POST 端点均调用已有服务层，不复制限流和去重代码。
- 完成 5 个客户端组件的 Action 引用切换：页面追踪、浏览量批量加载、管理员统计卡片、实时曲线和分页访问记录；删去过时的五处 `@ts-expect-error`。

## 测试与边界

- 访问追踪/统计历史 Action 原单测 **43/43** 通过，确认原业务逻辑未改。原测试错将明确传入 `pageSize:10` 的查询断言为默认 `25`，已修正为真正不传 pageSize 的默认测试；Node 内置 fs 相关单测标为 Vitest Node 环境。
- 新 HTTP 路由 **10/10** 通过，覆盖跨站 POST、无效输入、凭证注入、权限错误状态和私有缓存策略。
- 客户端请求形状和错误透传 **4/4** 通过。
- 跨批次定向回归 **58 个文件、1581/1581 项通过**；`next typegen`、`tsc --noEmit`、Web 全目录 ESLint 零警告通过。
- **仍待**：隔离 DB 的生产 Next.js 全量 build、真实环境中端到端计数和并发浏览、Cloudflare 访问速度与缓存命中测试。不得把当前结果解释为正式生产验收。

## 下一阶段

- 邮件订阅模块的管理员读取及统计；不把订阅确认、退订、群发邮件等有副作用行为暴露为 GET。
- Cloud 同步、Security、Auth 等安全敏感模块须单独权限审查。
- 进一步统一 HTTP 错误码 / 鉴权 / 输入校验，再推进匿名 HTML 的静态优先与按更新失效 ISR。
