# NeutralPress：Stats / Taxonomy 批量 GET 迁移

日期：2026-11-03。开发位置：ASUS `E:/NeutralPress`；分支：`feat/public-api-static-first`。本批只改本地源码，不推送或部署生产。之前的审计/Cron 批次另见 `api-migration-batch-audit-cron.md`。

## 迁移范围

以下新增查询都位于 **public-facing API**，但有既有后台角色限制；`public` 不是无需认证。请求携带同源 Cookie，鉴权、角色矩阵、限流、业务缓存逻辑仍由独立服务执行。

| GET 路由                                             | 业务     | 实现                              |
| ---------------------------------------------------- | -------- | --------------------------------- |
| `/api/public/admin/stats/users`                      | 用户统计 | `lib/server/services/stats.ts`    |
| `/api/public/admin/stats/audit`                      | 审计统计 | 同上                              |
| `/api/public/admin/stats/posts`                      | 文章统计 | 同上                              |
| `/api/public/admin/stats/tags`                       | 标签统计 | 同上                              |
| `/api/public/admin/stats/categories`                 | 分类统计 | 同上                              |
| `/api/public/admin/stats/pages`                      | 页面统计 | 同上                              |
| `/api/public/admin/stats/storage`                    | 存储统计 | 同上                              |
| `/api/public/admin/stats/visit`                      | 访问统计 | 同上                              |
| `/api/public/admin/stats/projects`                   | 项目统计 | 同上                              |
| `/api/public/admin/taxonomy/categories/list`         | 分类列表 | `lib/server/services/category.ts` |
| `/api/public/admin/taxonomy/categories/detail`       | 分类详情 | 同上                              |
| `/api/public/admin/taxonomy/categories/search`       | 分类搜索 | 同上                              |
| `/api/public/admin/taxonomy/categories/distribution` | 分类分布 | 同上                              |
| `/api/public/admin/taxonomy/categories/tree`         | 分类树   | 同上                              |
| `/api/public/admin/taxonomy/tags/list`               | 标签列表 | `lib/server/services/tag.ts`      |
| `/api/public/admin/taxonomy/tags/detail`             | 标签详情 | 同上                              |
| `/api/public/admin/taxonomy/tags/search`             | 标签搜索 | 同上                              |
| `/api/public/admin/taxonomy/tags/distribution`       | 标签分布 | 同上                              |

这 **18 项 GET 读取**采用原生浏览器 Fetch，摆脱客户端 Server Function POST 的串行派发限制。统计请求使用 `?force=true`；分类与标签读取的复杂筛选由 `?params=<URL 编码 JSON>` 传入，上限 4000 字符，并经过对应共享 Zod Schema 校验。**访问令牌绝不能放入 URL**：taxonomy 路由会拒绝出现 `access_token` 的参数对象，客户端也会剔除该字段。全部响应标记 `Cache-Control: private, no-store`。

## 实施原则

- 原 `actions/stat.ts` 的全部 9 个查询移至 `services/stats.ts`，旧模块保留带原有重载签名的异步兼容包装。
- 原 `actions/category.ts`、`actions/tag.ts` 的完整业务逻辑分别移至 `services/category.ts`、`services/tag.ts`。不仅查询，原写入能力也通过兼容 Action 委托给同一份业务实现，避免两套逻辑漂移；本批**没有将写操作改为 GET**。
- 页面只迁移原先导入的查询函数：原本混合读取和修改的 import 被拆分，新增 GET 辅助文件 `lib/client/api/stats.ts`、`category.ts` 和 `tag.ts`。在其它调用点的旧写 Action 保持有效。
- 新 Route Handler 与 server-only 服务均不得导入 `@/actions/*`；新的服务以 `import "server-only"` 明确约束。原数据模型、数据库、云环境、Cloudflare 规则均未修改。
- 角色校验遵循各功能原有逻辑，例如用户、审计、页面、访问、存储统计仅限管理员，文章与项目统计允许原有对应编辑/作者角色；禁止以 API 名称做权限决策。
- 不对任何登录、用户数据和管理统计启用 Cloudflare 共享缓存；在 ISR 改造完成后再设计仅匿名公开 HTML 的缓存白名单。

## 本批验证

- `src/actions/__tests__/stat.test.ts`：282/282 通过。
- `src/actions/__tests__/category.test.ts` 与 `tag.test.ts`：83/83 通过。
- 新增统计动态路由测试：11/11，通过未知指标拒绝、强刷参数、状态透传与九项分发。
- 新增分类、标签动态路由测试：14/14，通过输入 Schema、身份错误状态透传、敏感令牌拒绝及读取分发。
- 合并此前审计、Cron、搜索、通知等后，七个相关 Action 测试文件共 464/464、全部 Public API 测试文件共 51/51 通过（包含依赖边界测试）。
- `next typegen` + `tsc --noEmit` 通过；Prettier、ESLint 统一检查通过。当前没有声称已进行需要真实数据库密钥的完整 Next.js 正常生产构建。

## 后续待做

1. 继续处理内容域（文章列表、评论、媒体、图库）高频查询；新增每个路由的权限和客户端取消请求测试。
2. 完善分页、URL 查询参数的统一规范，逐渐替换 taxonomy 的单个 JSON 参数为可读的显式过滤字段。
3. 分离搜索日志及计数等查询遥测写入，保留业务一致性。
4. 独立推进公开页面完整 ISR + 更新后按需失效与 CDN Purge，不能因为迁移了 GET API 就立即 Cache Everything。
5. 在经过数据库环境中的完整构建与实际浏览器验收后，才合并至主分支及部署 Texas VPS。
