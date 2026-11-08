<div align="center">

# NeutralPress

基于 Next.js 构建的下一代动态横板 CMS 博客系统

// Next.js-powered next-gen dynamic horizontal CMS blog. //

![GitHub last commit](https://img.shields.io/github/last-commit/RavelloH/NeutralPress?style=for-the-badge)
![GitHub repo size](https://img.shields.io/github/repo-size/RavelloH/NeutralPress?style=for-the-badge)
![GitHub Repo stars](https://img.shields.io/github/stars/RavelloH/NeutralPress?style=for-the-badge)

Demo: [https://ravelloh.com](https://ravelloh.com) | Docs: [https://neutralpress.net](https://neutralpress.net)

</div>

## 简介

NeutralPress 是一个基于 Next.js 的 CMS 系统，其在生态位上与 WordPress 类似，你可以所见即所得的通过强大的后台管理系统来管理你的站点，所有更改都会实时应用。

WordPress 之所以流行，是因为它易于使用且功能强大。但其技术栈陈旧、性能要求高、功能依靠插件、后台风格过时，且强需求服务器，难以免费部署。我们致力于解决这些问题，通过融合静态站点生成器（如 Hexo）和动态CMS系统（如 WordPress）的优点，提供一个低成本、易于使用且功能强大的内容管理平台。

仅当内容变更时，NeutralPress 才会使用动态增量再生（ISR）技术重新生成发生更改的页面，而在内容未变更时，页面与静态页面类似。这既确保内容可实时更新，又能享受静态页面的高性能、SEO友好和低成本优势。

因此，你可以 **0 成本** 的免费部署 NeutralPress 到任何支持 Serverless 的云平台，而无需实际管理服务器。或者，如果你愿意，你也可以选择使用 Docker 自托管。

———— 以静态博客的成本，享受动态 CMS 的便利。NeutralPress 致力于成为下一代内容管理系统，让人人都能免费建站。

## 设计

你是否已经厌倦了千篇一律的网站设计？

我们的默认主题使用了现代化的设计风格，在融合了国际平面主义风格、新粗野主义的同时，仍保持简洁的风格。

使用 CMS 最多的不是访客，而是站长。因此，无论是后台还是前台，我们均保持完全统一的设计风格。

———— 保持中性，将情绪留给内容本身。**Neutral**，意为“**中性**”，象征着简洁与纯粹。

## 功能

不仅仅只是个文章发布平台。一键部署，你就可以拥有：

- **行云流水的内容系统**，所见即所得、支持 Markdown / MDX 可视化编辑、草稿箱、版本管理，内置 SEO 深度优化。
- **独具匠心的页面系统**，支持拖拽组件、实时预览，也可使用 HTML / Markdown / MDX 新建页面。
- **井井有条的归档系统**，以标签和分类两个维度对文章进行组织，支持自定义。
- **强大的媒体管理系统**，自动压缩、图片优化、防盗链、短链接、照片墙、Exif 信息展示。
- **多用户权限管理系统**，支持多角色、多权限分配，支持访客注册、 Github / Google / Microsoft OAuth 登录、Passkey 登录、TOTP 双因素认证、会话管理、敏感操作二次验证。
- **毫不妥协的安全系统**，内置速率限制 WAF、IP 封禁系统，重要端点自带 PoW 验证码，并使用 Server Action 代替 API 通信以增强安全性。
- **详细的访问统计系统**，内置访客分析、搜索关键词与全站关键词对比、访客来源、设备分析、文章热度分析等，自动发送日报/周报/月报。
- **无限层级的评论系统**，支持嵌套回复、评论审核、评论点赞，内置评论反垃圾系统。
- **事无巨细的审计系统**，记录每一次内容更改，所有操作可追溯、可还原。
- **洞察秋毫的搜索系统**，高性能分词与索引，专为中文内容及编程术语进行了优化。后续将支持AI向量搜索。
- **即时通达的通讯系统**，基于 WebSocket ，支持实时私信、在线 / 输入状态显示等。后续将支持端对端加密私聊。
- **无远弗届的通知系统**，整合站内信、Email、WebPush 推送，支持精细化的通知订阅策略。
- **兼容并蓄的订阅系统**，支持 RSS ，支持邮件通讯录订阅。
- **别出心裁的作品系统**，独立于文章的展示维度，专为项目展示设计的网格布局与详情页、GitHub 仓库卡片同步。
- **守望相助的友链系统**，支持友链自助申请、自动抓取元信息、健康度巡检，自动标记或隐藏失效链接。
- **海纳百川的存储系统**，同时支持本地文件系统、AWS S3、Cloudflare R2、Vercel Blob 、OSS，甚至 Github Pages 。多种对象存储策略可并存，切换自如。
- **防微杜渐的诊断系统**，支持定时健康检查、性能分析，自动优化。即使在 Serverless 环境下，也能正常执行定时任务。

‧‧‧‧‧‧

不止如此。篇幅有限，完整功能介绍及相关功能截图，请在 [功能列表](https://neutralpress.net/docs/feature) 中查看。

我们仍在不断更新，如果有更多功能需要，欢迎前往 [GitHub 讨论区](https://github.com/RavelloH/NeutralPress) 提出建议。

———— AI 时代，仅靠内容是不够的。NeutralPress 不仅仅只是一个内容管理系统，也是你的私人社区、数字门户、个人知识库。

## 预览

<h3>前台默认主题</h3>
<div align="center">
  <table>
    <tbody>
      <tr>
        <td width="33%"><a href="https://neutralpress.net/repo/front/front-1.webp"><img src="https://neutralpress.net/repo/front/front-1.webp" width="100%" alt="Front 1"></a></td>
        <td width="33%"><a href="https://neutralpress.net/repo/front/front-2.webp"><img src="https://neutralpress.net/repo/front/front-2.webp" width="100%" alt="Front 2"></a></td>
        <td width="33%"><a href="https://neutralpress.net/repo/front/front-3.webp"><img src="https://neutralpress.net/repo/front/front-3.webp" width="100%" alt="Front 3"></a></td>
      </tr>
      <tr>
        <td><a href="https://neutralpress.net/repo/front/front-4.webp"><img src="https://neutralpress.net/repo/front/front-4.webp" width="100%" alt="Front 4"></a></td>
        <td><a href="https://neutralpress.net/repo/front/front-5.webp"><img src="https://neutralpress.net/repo/front/front-5.webp" width="100%" alt="Front 5"></a></td>
        <td><a href="https://neutralpress.net/repo/front/front-6.webp"><img src="https://neutralpress.net/repo/front/front-6.webp" width="100%" alt="Front 6"></a></td>
      </tr>
      <tr>
        <td><a href="https://neutralpress.net/repo/front/front-7.webp"><img src="https://neutralpress.net/repo/front/front-7.webp" width="100%" alt="Front 7"></a></td>
        <td><a href="https://neutralpress.net/repo/front/front-8.webp"><img src="https://neutralpress.net/repo/front/front-8.webp" width="100%" alt="Front 8"></a></td>
        <td><a href="https://neutralpress.net/repo/front/front-9.webp"><img src="https://neutralpress.net/repo/front/front-9.webp" width="100%" alt="Front 9"></a></td>
      </tr>
      <tr>
        <td><a href="https://neutralpress.net/repo/front/front-10.webp"><img src="https://neutralpress.net/repo/front/front-10.webp" width="100%" alt="Front 10"></a></td>
        <td><a href="https://neutralpress.net/repo/front/front-11.webp"><img src="https://neutralpress.net/repo/front/front-11.webp" width="100%" alt="Front 11"></a></td>
        <td><a href="https://neutralpress.net/repo/front/front-12.webp"><img src="https://neutralpress.net/repo/front/front-12.webp" width="100%" alt="Front 12"></a></td>
      </tr>
      <tr>
        <td><a href="https://neutralpress.net/repo/front/front-13.webp"><img src="https://neutralpress.net/repo/front/front-13.webp" width="100%" alt="Front 13"></a></td>
        <td><a href="https://neutralpress.net/repo/front/front-14.webp"><img src="https://neutralpress.net/repo/front/front-14.webp" width="100%" alt="Front 14"></a></td>
        <td><a href="https://neutralpress.net/repo/front/front-15.webp"><img src="https://neutralpress.net/repo/front/front-15.webp" width="100%" alt="Front 15"></a></td>
      </tr>
      <tr>
        <td><a href="https://neutralpress.net/repo/front/front-16.webp"><img src="https://neutralpress.net/repo/front/front-16.webp" width="100%" alt="Front 16"></a></td>
        <td><a href="https://neutralpress.net/repo/front/front-17.webp"><img src="https://neutralpress.net/repo/front/front-17.webp" width="100%" alt="Front 17"></a></td>
        <td><a href="https://neutralpress.net/repo/front/front-18.webp"><img src="https://neutralpress.net/repo/front/front-18.webp" width="100%" alt="Front 18"></a></td>
      </tr>
      <tr>
        <td><a href="https://neutralpress.net/repo/front/front-19.webp"><img src="https://neutralpress.net/repo/front/front-19.webp" width="100%" alt="Front 19"></a></td>
        <td><a href="https://neutralpress.net/repo/front/front-20.webp"><img src="https://neutralpress.net/repo/front/front-20.webp" width="100%" alt="Front 20"></a></td>
        <td><a href="https://neutralpress.net/repo/front/front-21.webp"><img src="https://neutralpress.net/repo/front/front-21.webp" width="100%" alt="Front 21"></a></td>
      </tr>
    </tbody>
  </table>
</div>

<h3>后台默认主题</h3>
<div align="center">
  <table>
    <tbody>
      <tr>
        <td width="33%"><a href="https://neutralpress.net/repo/admin/admin-1.webp"><img src="https://neutralpress.net/repo/admin/admin-1.webp" width="100%" alt="Front 1"></a></td>
        <td width="33%"><a href="https://neutralpress.net/repo/admin/admin-2.webp"><img src="https://neutralpress.net/repo/admin/admin-2.webp" width="100%" alt="Front 2"></a></td>
        <td width="33%"><a href="https://neutralpress.net/repo/admin/admin-3.webp"><img src="https://neutralpress.net/repo/admin/admin-3.webp" width="100%" alt="Front 3"></a></td>
      </tr>
      <tr>
        <td><a href="https://neutralpress.net/repo/admin/admin-4.webp"><img src="https://neutralpress.net/repo/admin/admin-4.webp" width="100%" alt="Front 4"></a></td>
        <td><a href="https://neutralpress.net/repo/admin/admin-5.webp"><img src="https://neutralpress.net/repo/admin/admin-5.webp" width="100%" alt="Front 5"></a></td>
        <td><a href="https://neutralpress.net/repo/admin/admin-6.webp"><img src="https://neutralpress.net/repo/admin/admin-6.webp" width="100%" alt="Front 6"></a></td>
      </tr>
      <tr>
        <td><a href="https://neutralpress.net/repo/admin/admin-7.webp"><img src="https://neutralpress.net/repo/admin/admin-7.webp" width="100%" alt="Front 7"></a></td>
        <td><a href="https://neutralpress.net/repo/admin/admin-8.webp"><img src="https://neutralpress.net/repo/admin/admin-8.webp" width="100%" alt="Front 8"></a></td>
        <td><a href="https://neutralpress.net/repo/admin/admin-9.webp"><img src="https://neutralpress.net/repo/admin/admin-9.webp" width="100%" alt="Front 9"></a></td>
      </tr>
      <tr>
        <td><a href="https://neutralpress.net/repo/admin/admin-10.webp"><img src="https://neutralpress.net/repo/admin/admin-10.webp" width="100%" alt="Front 10"></a></td>
        <td><a href="https://neutralpress.net/repo/admin/admin-11.webp"><img src="https://neutralpress.net/repo/admin/admin-11.webp" width="100%" alt="Front 11"></a></td>
        <td><a href="https://neutralpress.net/repo/admin/admin-12.webp"><img src="https://neutralpress.net/repo/admin/admin-12.webp" width="100%" alt="Front 12"></a></td>
      </tr>
      <tr>
        <td><a href="https://neutralpress.net/repo/admin/admin-13.webp"><img src="https://neutralpress.net/repo/admin/admin-13.webp" width="100%" alt="Front 13"></a></td>
        <td><a href="https://neutralpress.net/repo/admin/admin-14.webp"><img src="https://neutralpress.net/repo/admin/admin-14.webp" width="100%" alt="Front 14"></a></td>
        <td><a href="https://neutralpress.net/repo/admin/admin-15.webp"><img src="https://neutralpress.net/repo/admin/admin-15.webp" width="100%" alt="Front 15"></a></td>
      </tr>
      <tr>
        <td><a href="https://neutralpress.net/repo/admin/admin-16.webp"><img src="https://neutralpress.net/repo/admin/admin-16.webp" width="100%" alt="Front 16"></a></td>
        <td><a href="https://neutralpress.net/repo/admin/admin-17.webp"><img src="https://neutralpress.net/repo/admin/admin-17.webp" width="100%" alt="Front 17"></a></td>
        <td><a href="https://neutralpress.net/repo/admin/admin-18.webp"><img src="https://neutralpress.net/repo/admin/admin-18.webp" width="100%" alt="Front 18"></a></td>
      </tr>
      <tr>
        <td><a href="https://neutralpress.net/repo/admin/admin-19.webp"><img src="https://neutralpress.net/repo/admin/admin-19.webp" width="100%" alt="Front 19"></a></td>
        <td><a href="https://neutralpress.net/repo/admin/admin-20.webp"><img src="https://neutralpress.net/repo/admin/admin-20.webp" width="100%" alt="Front 20"></a></td>
        <td><a href="https://neutralpress.net/repo/admin/admin-21.webp"><img src="https://neutralpress.net/repo/admin/admin-21.webp" width="100%" alt="Front 21"></a></td>
      </tr>
    </tbody>
  </table>
</div>

## Demo

你可以前往 [https://ravelloh.com](https://ravelloh.com) 来体验其前台显示效果。

<!-- 或者，前往 [Code Sandbox](https://codesandbox.io/p/sandbox/github/ravelloh/neutralpress) 来直接运行一个实例 Demo。在初始化后的 NeutralPress 中直接注册账号后，即可前往后台体验完整的 CMS 功能。 -->

不过，我们更推荐你直接部署一个 NeutralPress 实例，以便体验全部功能。选择任意一种部署方式，几分钟内即可完成部署并开始使用。

<!--（如果需要，你可以前往后台的“备份还原”页面，导出 Demo 的数据并导入到自己的实例中。参照 [备份与还原](https://neutralpress.net/docs/feature/backup) ） -->

## 快速开始

参考 [https://neutralpress.net/docs/deploy](https://neutralpress.net/docs/deploy)

## 一键部署

[![Deploy on RepoCloud](https://d16t0pc4846x52.cloudfront.net/deploylobe.svg)](https://repocloud.io/details/NeutralPress/)

## 贡献

NeutralPress 是一个开源项目，欢迎任何人参与贡献代码、文档、设计等。
如果你有兴趣参与贡献，请前往我们的 [GitHub 仓库](https://github.com/RavelloH/NeutralPress) ，并查看 [开发文档](https://neutralpress.net/docs/dev) 以了解如何开始。

NeutralPress 也可以运行在 无头模式（Headless Mode），如果你有兴趣将 NeutralPress 作为内容后端集成到你自己的前端项目中，请参考 [API文档](https://neutralpress.net/docs/api) 。

NeutralPress 支持在 MDX 中使用 JSX 语法编写 React 插件。如果你有兴趣编写插件，请参考 [插件开发指南](https://neutralpress.net/docs/dev/plugins) 。

NeutralPress 在未来将支持主题切换功能。如果你有兴趣编写主题，请参考 [主题开发指南](https://neutralpress.net/docs/dev/themes) 。

NeutralPress 目前仍在积极开发中，如果你有任何建议或反馈，欢迎前往 [GitHub 讨论区](https://github.com/RavelloH/NeutralPress/discussions) 提出。
如果发现任何 Bug，请前往 [GitHub ISSUE](https://github.com/RavelloH/NeutralPress/issues) 提交。

衷心感谢所有为 NeutralPress 做出贡献的开发者和用户！

![贡献](https://contrib.rocks/image?repo=RavelloH/NeutralPress)
