# NeutralPress API 迁移：Page / Project / FriendLink / User / Message（2026-11-03）

## 本批交付范围

- 开发目录：ASUS `E:/NeutralPress`，分支 `feat/public-api-static-first`。没有使用线上数据库执行构建、没有部署 VPS、没有推送。
- 本批新增 **20 项原生 GET**，路由以 7 个动态处理器集中分发：`pages` 3 项、`admin/projects` 3 项、`friends` 1 项、`admin/friends` 4 项、`admin/users` 2 项、`users` 3 项、`messages` 4 项。
- 另有页面 Block 动态预览数据使用 **JSON POST** `/api/public/admin/pages/block-data`，不再由 Server Action 串行派发。避免把动态 Block JSON 输入放进 URL；GET 只用于小体积、无副作用读取。
- 五个模块 `actions/page.ts`、`project.ts`、`friendlink.ts`、`user.ts`、`message.ts` 的完整实现下沉到 `lib/server/services/*-domain.ts`；原 Action 仅负责兼容转发，现有写入 API 签名、SQL、鉴权及限流继续由同一份服务实现。
- 21 个读取调用点（页面/项目/友链/用户后台、个人资料、消息列表与轮询、页面编辑器等）从 Action 切换到 `lib/client/api/*-read.ts` 的同源 GET 或服务端直接服务调用，写入 Action 保留。BlockLibrary、VisualPageEditor 的 Block 请求采用独立受保护 POST。
- `lib/server/reauth-verify.ts` 提取原 `checkReauthToken` 及 IP/UA 绑定和 token 校验，避免 `user-domain.ts` 引入 `actions/reauth.ts`；原 Action 保留兼容接口。私信服务保留历史可选参数重载形式。

## 访问控制与性能边界

- `public` 是客户端可调用 API 命名空间，**不等于匿名授权**。所有私有、后台、账户和私信 GET 返回 `Cache-Control: private, no-store`，禁止将这些响应交给 Cloudflare Cache Everything。
- 仍由业务服务验证原有权限：私信依据 Cookie 认证并核对会话参与者；用户自己的资料只能通过当前 Cookie 获取；用户活动的访客/已登录限制由服务端推断，不允许客户端伪造 `isGuest=false`；未更改现有管理员鉴权机制。
- GET 严格限定 operation 白名单、仅接受 JSON `params` 查询字段，拒绝重复字段、非对象参数、URL 中 `access_token`，URL 参数不超过 8192 字符。新客户端封装主动剔除令牌。
- 后台列表每页最大 500，趋势范围不超过 365 天且数据点不超过 100；私信会话与消息分页拒绝非安全整数；所有请求仍受原限流及业务角色检查。
- Block POST 同源 Cookie、只接受 JSON，校验 Host/Origin 和 Sec-Fetch-Site，最大 128 KiB，Zod 约束输入结构，不接受浏览器传入 access_token，复用 ADMIN 服务授权及限流。
- Public API 架构边界测试扩展至所有 route.ts、全部 client/api helper 和全部 `lib/server/services` 服务，明确不得依赖 `actions/`，服务必须 `server-only`。

## 目前的验证记录

- 大批次迁移全域定向回归：**44 个测试文件、1354/1354 用例通过**，覆盖旧 Action 与新 GET/POST 路由、身份认证、分类标签、文章评论媒体、审计、Cron、搜索等。
- 新增分页、趋势时间跨度、私信整数分页边界测试独立 **32/32 通过**；重新认证测试在专用 Node 测试环境下 **31/31 通过**。此类用例已包含在不同交叉运行中，不重复累计。
- `next typegen`、`tsc --noEmit`、Web 全量 ESLint（0 警告）与 Prettier 格式检查已通过。
- Web 全量 Vitest 曾有 703/3945 失败的历史环境基线，不能声称整个仓库全部通过；已将本次 `reauth.test.ts` 改为适合 Node builtin 的 Node 环境并通过。
- 尚无隔离数据库完整生产 `pnpm build` 及线上性能对比，不能把测试通过理解成部署验收；Next.js prebuild 可更新 DB/缓存，不得在开发机连接生产 DB 直接 build。

## 后续迁移

- 优先 `mail-subscription`、`analytics`、`storage`、`doctor`、`menu` 等包含较多客户端读取的域，逐个清查只读操作、角色与数据范围。
- Auth、Security、Passkey、TOTP、SSO 等涉及身份认证和状态变更，必须单独进行安全审查，不可机械地改成 GET；修改操作使用明确的 JSON POST/PATCH/DELETE 及 CSRF 保护。
- 完成 API 适配后才进入整页 ISR、精确 revalidation、Cloudflare 缓存命中及瀑布图性能对比。
