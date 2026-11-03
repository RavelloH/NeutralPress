# NeutralPress 内容域批量 API 迁移（2026-11-03）

## 范围与交付状态

开发分支：`feat/public-api-static-first`；ASUS 路径：`E:/NeutralPress`。仅本地实施，未推送 GitHub，也未修改 Texas VPS 生产服务。

本批新增 **20 项 GET 读取**，使用 5 个动态 Route Handler 分发。接口路由统一位于 `/api/public/*`，但是 public **仅表示允许客户端直接请求**，不是免登录，也不是 CDN 可公开缓存。

| 域                                       | GET 操作（URL 尾部 operation）                                           | 业务服务                                |
| ---------------------------------------- | ------------------------------------------------------------------------ | --------------------------------------- |
| `/api/public/posts/[operation]`          | `trends`、`list`、`detail`、`history`、`version`、`protected-content`    | `lib/server/services/post-domain.ts`    |
| `/api/public/comments/[operation]`       | `post`、`replies`、`children`                                            | `lib/server/services/comment-domain.ts` |
| `/api/public/admin/comments/[operation]` | `list`、`history`、`stats`                                               | `lib/server/services/comment-domain.ts` |
| `/api/public/media/[operation]`          | `gallery`                                                                | `lib/server/services/media-domain.ts`   |
| `/api/public/admin/media/[operation]`    | `list`、`detail`、`stats`、`trends`、`folders`、`breadcrumb`、`explorer` | `lib/server/services/media-domain.ts`   |

## 关键设计与安全约束

- 三大旧 Action 模块 `actions/post.ts`、`actions/comment.ts`、`actions/media.ts` 的实现已转移到相应 `server-only` 服务；旧 Action 使用保留重载签名的薄兼容包装，将所有原读取及写入操作委托给同一个业务服务，避免两份权限逻辑/SQL。
- 五条新 Route Handler 全部直接引用 `@/lib/server/services/*-domain`，不引用 `actions/`，只允许列出的 GET 读取操作；写入功能没有开放 GET。
- 新客户端使用 `lib/client/api/read.ts` 公共 GET 封装，支持同源凭证、`AbortSignal` 与 `cache: no-store`。客户端请求无 Server Function POST 序列化队列。
- GET 参数采用一个 JSON 对象 URL 编码到 `params`，目前限长 8192 字符，严格限制 URL 查询键为 `params`；请求对象中出现 `access_token` 直接拒绝，封装层也会剔除令牌。每个操作通过已有 Zod Schema 或专门校验。
- 这些读取包含受保护文章、管理员统计和私有媒体文件，响应统一标记 `Cache-Control: private, no-store`。不应在 Cloudflare 运行 Cache Everything。具体授权沿用原服务角色、文章访问策略、用户 Cookie 与限流。
- 媒体 `folders` GET 从 Cookie 验证的当前用户 JWT 读取角色和 UID，并在服务层二次鉴权；不使用客户端输入的 `userRole/userUid` 作为可信身份。
- 原 `actions/media.ts` 的 15 组 exported interface 已下沉至 `lib/shared/media-types.ts`，浏览器媒体列表及目录工具不再从 Action 引用这些类型；原路径保留 `export type` 以向后兼容。
- 原媒体 `lib/client/folder-utils.ts` 已改用 GET 读取目录和面包屑；本阶段没有改动创建文件夹、移动媒体、删除文件或文章编辑等写入行为。
- 部分文件读取缓存仍由服务层内部完成，外层 GET 的 `no-store` 仅禁止用户/共享 HTTP 响应缓存，与后续仅针对匿名 HTML 的整页 ISR 是两套独立策略。

## 已执行验证

- 原文章、评论、媒体 Action 单测 **481/481 通过**（覆盖读、写、权限及业务边界）；五个动态 GET Route Handler 测试和媒体目录新增鉴权测试 **31/31 通过**。
- 新 GET 封装测试 3/3 通过（URL 令牌剔除、同源 Cookie 与 AbortSignal、服务器错误传播），Public API 依赖边界测试 3/3 通过；本批集中回归 **518/518 通过**。
- `next typegen` + `tsc --noEmit` 通过，Web 整目录 ESLint 0 warning，全部修改文件 Prettier check 通过，`git diff --check` 通过。
- 之前全量 Vitest 基线（3945 项中 703 失败）尚未解决；其中 URL 安全测试改为 Node 环境已单独 70/70 通过。不能将本次定向回归通过解读为整仓全绿。
- 尚未使用真实数据库副本执行完整 Next.js `pnpm build`，避免仓库 prebuild 对线上数据库产生更新、缓存重建副作用；生产部署及 Cloudflare 规则未动。

## 下一阶段

- 尚有 `page`、`project`、`friendlink`、`user`、`message` 等模块的频繁读取及编辑器数据请求需要分批迁移。
- 分离纯业务 Domain Service 与 ResponseBuilder/headers 请求适配；统一错误结构、授权上下文和 JSON 查询参数序列化规范。
- 修复 Vitest/React/Node 测试环境并与旧版基线对照；随后在隔离数据库副本正常构建和浏览器联调。
- 独立实施匿名 HTML 的整页 ISR、更新后精确 revalidation、Cloudflare CDN 缓存命中及性能指标验证。
