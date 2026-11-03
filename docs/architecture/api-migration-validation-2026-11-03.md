# NeutralPress API 大批次迁移验收记录（2026-11-03）

## 变更与独立提交

- 功能分支：`feat/public-api-static-first`。本地提交：`cddc8998`、`80612b0e`、`3037be68`、`a5c4ad36`、`ff313f52`。
- 当前累计迁移 26 项客户端 GET 查询能力，包括本次新增的 22 项（Stats 9、Category 5、Tag 4、Audit 2、Cron 2）。
- 新 Route Handler 调用 server-only 服务；旧 Action 保留兼容包装及原权限校验。
- 没有推送、没有部署生产站点，未运行涉及数据库更新的 prebuild。

## 已通过的验证

- 迁移有关 19 个测试文件、515/515 用例通过，涵盖旧 Action 兼容、参数边界、401/403、角色与敏感 GET 令牌拒绝。
- `next typegen` 与 `tsc --noEmit` 通过；完整 `apps/web` ESLint `--max-warnings 0 .` 通过。
- `src/app/api/public/__tests__/boundary.test.ts` 在 Node 环境运行 3/3 通过，保证 Route Handler 与核心服务不依赖 actions。
- Git 工作区干净，最近提交无环境密钥、Prisma migration 或正式 Cloudflare 配置修改。

## 全仓测试现状与待排查事项

- 在 ASUS 上运行 `corepack pnpm --filter web exec vitest run --reporter=dot`：169 个测试文件，3945 项测试，其中 3242 通过、703 失败、52 个文件报错。
- 主要故障类型包括 `React.act is not a function`（Hooks 测试）、`net.isIP is not a function`、Node 内置模块浏览器兼容 externalize、`path.basename` 未定义以及部分超时。
- 交叉验证：`corepack pnpm --filter web exec vitest run src/lib/server/__tests__/url-security.test.ts --environment=node` 得到 **70/70 通过**；确认 URL 安全模块相关失败至少部分来自测试环境而非业务回归。
- 不能仅凭这一证据断言其它失败全部属于既有问题；下一阶段需要在基线提交上对照全量 Vitest，再逐个恢复测试隔离和模拟，之后才能视为完整发布验收通过。
- 本批不应临时禁用 URL 安全测试，也不应调整生产应用安全逻辑来迎合错误的测试环境。

## 后续

- 完善 Vitest 4 / happy-dom / React act 兼容与 Node/server-only 模块分环境测试配置。
- 继续文章、评论、媒体、图库等数据读取 GET 化，区分读取与业务 mutation。
- 在隔离数据库和 Redis 上完成正常生产 build 后，推进整页 ISR、精确 revalidation、Cloudflare 缓存与性能 A/B 测试。
