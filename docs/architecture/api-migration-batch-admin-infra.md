# NeutralPress API 迁移批次：Menu / Storage / Doctor / Recycle Bin（2026-11-03）

开发环境：ASUS，`E:/NeutralPress`，`feat/public-api-static-first`；只修改本地 Git 分支，不部署或改变生产数据库。

## 实现

- `menu` 3 项 GET：后台菜单统计、列表、详情。
- `storage` 2 项 GET：存储提供器列表及详情。详情可能包含存储服务配置，必须维持 ADMIN 原角色鉴权，**所有响应 `private,no-store`**，严禁 CDN 共享缓存。
- `doctor` 2 项 GET：诊断历史和趋势。执行实际诊断的 `doctor()` 仍是有副作用 Action，不通过 GET 提供。
- `recycle-bin` 2 项 GET：回收站列表和统计。恢复、彻底删除、清空等操作仍保留原 Action，不允许通过 GET 触发。
- 新增 4 组 GET 动态路由：`/api/public/admin/{menus,storages,doctor,recycle-bin}/[operation]`，显式操作白名单，数据校验沿用 shared-types Zod Schema，移除可查询的 access_token；任意 GET URL 中出现访问令牌或额外查询字段都会被拒绝。响应均加 `X-Content-Type-Options:nosniff`。
- 完整服务逻辑（包括写操作）从 `actions/{menu,storage,doctor,recycle-bin}.ts` 下沉到 `lib/server/services/*-domain.ts` 并标记 `server-only`，旧 Action 只保留薄兼容包装；没有复制权限或 SQL 实现。
- 四个 `lib/client/api/*-read.ts` 调用既有同源 GET transport（`credentials:same-origin`、`cache:no-store`、`AbortSignal`、主动剔除 access_token），后台 9 个组件和 `use-storage-providers` Hook 已从读取 Action 切换为 GET。
- 菜单列表每页最多 500，诊断趋势数据点最多 100；存储页面大小原 Schema 上限 500，回收站原 Schema 上限 100。原业务服务角色、限流和数据范围保持原样。

## 验证

- 四个模块原有 Action 单元测试 131/131 通过，涵盖读取、写入、权限和失败处理。
- 新四组 GET 路由 20/20 测试通过，覆盖非法查询、访问令牌拒绝、授权失败状态透传及私有缓存响应。
- 存储 Hook 测试改为 Mock 新 GET 适配器，同时发现 ASUS 全局 `NODE_ENV=production` 导致 `React.act` 不可用；**仅测试进程**指定 `NODE_ENV=test`，Hook 14/14 通过，未更改生产运行设置。
- 扩展跨批次联合回归：**53 个测试文件、1524/1524 项通过**。`next typegen`、`tsc --noEmit`、Web 整目录 ESLint 零警告和 Git 差异检查通过。
- 不等于整个 Web 全量测试都已通过；其它历史测试基线仍待验证，也尚未使用隔离 DB 进行带数据库副作用的完整生产构建。

## 后续

- 优先处理 `analytics` 的匿名页面访问统计与批量浏览量等高频客户端请求；追踪属于写操作，应使用受限 JSON POST 而非 GET。
- 随后审查 `mail-subscription` 与 Cloud 配置、权限安全等模块，保持邮件凭证与存储密钥永不共享缓存；对危险写入建立明确 CSRF 边界。
- API 层稳定后实施匿名公开 HTML 的整页 ISR、精确失效和 Cloudflare 缓存策略。
