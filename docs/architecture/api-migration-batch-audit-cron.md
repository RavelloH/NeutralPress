# NeutralPress Public API 大批次迁移：Audit / Cron

日期：2026-11-03。分支：`feat/public-api-static-first`。本批仅修改 ASUS 本地，不部署正式站点。

## 四条独立 GET 接口

| GET Path                         | 权限  | 业务服务                              | 缓存                |
| -------------------------------- | ----- | ------------------------------------- | ------------------- |
| `/api/public/admin/audit/logs`   | ADMIN | `lib/server/services/audit.ts`        | `private, no-store` |
| `/api/public/admin/audit/trends` | ADMIN | `lib/server/services/audit.ts`        | `private, no-store` |
| `/api/public/admin/cron/history` | ADMIN | `lib/server/services/cron-history.ts` | `private, no-store` |
| `/api/public/admin/cron/trends`  | ADMIN | `lib/server/services/cron-history.ts` | `private, no-store` |

- public 表示客户端 API 命名空间，不代表免认证。服务层继续执行原 ADMIN 鉴权和频率限制。
- GET 参数明确白名单，通过原业务 Zod Schema，整数参数严格验证，访问令牌不得作为 URL 参数。
- `lib/client/api/audit.ts`、`lib/client/api/cron-history.ts` 使用同源 fetch + no-store，并可通过 AbortSignal 取消客户端等待。
- 改造了审计列表、审计趋势、Cron 历史列表、Cron 趋势、Cron 报告五个客户端模块。
- 旧 `actions/audit.ts` 的两个读取方法及 `actions/cron.ts` 的历史与趋势方法只保留兼容包装，读取业务逻辑移到 server-only 服务。
- Cron 配置读取 `getCronConfig` 暂时保留原 Action，它与写入配置逻辑使用复杂共享助手；不在本批复制或破坏写入逻辑。

## 验证

- Audit/Cron 旧 Action 测试 21/21、四条 GET 路由新增测试 12/12，总计本批 33/33，通过。
- 完整 TypeScript 检查与 Next.js route typegen 通过；本批涉及文件 ESLint 零警告；Prettier 已格式化。
- Public API 架构边界测试已修复 Node 环境并运行通过 3/3，验证 Route Handler 与服务层无 Action 依赖。
- 工作区存在其它正在进行的 Stats/Category/Tag 迁移，本批必须仅选择性提交 Audit/Cron 及本文档，避免误提交或覆盖并行改动。

## 待办

- 全局 API 权限矩阵、统一请求上下文、鉴权错误码；Cron 配置单独解耦。
- 内容域（文章、评论、分类、图库）继续批量迁移 GET；待 API 层稳定后再推进静态 ISR 与 CDN 失效。
