# NeutralPress Cloud 同步只读 API 迁移（2026-11-03）

ASUS：`E:/NeutralPress`，本地分支 `feat/public-api-static-first`；未推送、未部署、未访问线上 Cloud 远端或数据库。

## 代码结构与接口

- Cloud 业务六组函数（获取配置、修改配置、主动同步、远端状态查询、历史、趋势）从 `actions/cloud.ts` 整体下沉到 `lib/server/services/cloud-domain.ts`，改为 `server-only`，原 Action 保留完整函数重载和兼容实现。
- 新 HTTP API `/api/public/admin/cloud/[operation]` 仅开放两个只读 operation，直接引用服务层。
- `history` 使用**普通 JSON POST**：历史筛选 `deliveryId` 可能包含私有投递标识，不允许出现在 URL、浏览器历史或边缘访问日志。请求体大小限制 8 KiB，严格 Zod Schema、同源来源校验。
- `trends` 使用 GET：原 `GetCloudTrendsSchema`，额外要求 `count <= 100`，避免过大聚合。GET 拒绝未知操作、超长参数、重复查询字段及任何 `access_token`。
- 两个接口均由现有业务服务 ADMIN 鉴权与限流，统一 `Cache-Control: private, no-store` 和 `X-Content-Type-Options: nosniff`。新客户端 `lib/client/api/cloud-read.ts` 支持同源 Cookie 和 AbortSignal。
- 历史表格、历史趋势图改用新客户端；`getCloudConfig`、`getCloudRemoteStatus`、`syncCloudNow`、`updateCloudConfig` 仍保留原 Action 入口，**没有开放密钥配置、远端网络探测或执行同步的读/写操作**。

## 测试与审查

- 经 Node `git show HEAD:apps/web/src/actions/cloud.ts` 对照，提取到服务层的代码除了 `use server` 变为 `server-only` 外，**字节级一致**；未修改签名或核心同步业务逻辑。
- 原 Cloud 单测首次 50/51 通过，失败由旧测试误 Mock `prisma.config.upsert` 而业务使用 `prisma.$transaction` 导致。修正测试 Mock 后 **51/51 项通过**，没有为通过测试而修改业务行为。
- 新 HTTP 路由与客户端测试 **8/8 通过**：敏感投递标识不进 URL、违规操作不可通过路由访问、权限错误及 429 状态透传、严格 Zod、私有响应禁止共享缓存。
- 覆盖前面全部迁移批次的联合回归 **64 个测试文件、1667/1667 项通过**。`next typegen`、全 Web `tsc --noEmit`、全目录 ESLint 零警告及 `git diff --check` 通过。
- 本阶段仍**未进行隔离数据库生产完整 build、浏览器实际操作和 Cloudflare 缓存实测**，不等同于生产验收。

## 下一阶段

- 审查 Security/Backup/SSO/Passkey/TOTP 等剩余模块，仅迁移能够安全外露的纯读取；带凭证、查询隐私数据的使用 JSON POST 而不是 GET。
- 统一客户端 HTTP helper、鉴权与响应码，清除遗留 Server Action 读取依赖；明确页面更新后 ISR/缓存失效策略和 CDN 缓存命中目标。
