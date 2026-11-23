# XlcBlog

极简阅读与个人品牌结合的静态博客。使用 Astro、TypeScript 和原生 CSS，包含个人介绍、项目、Markdown 文章、分类与搜索、明暗主题和手机布局。

## 本地开发

要求 Node.js 22.12 或更新版本。

```sh
npm ci
npm run dev
```

开发地址以终端输出为准，默认是 `http://127.0.0.1:4321`。

```sh
npm run check
npm run build
npm run preview
```

构建会先执行 Astro / TypeScript 检查，再生成静态文件到 `dist/`。

## 替换内容

- `src/data/site.ts`：昵称、个人介绍、联系方式、项目与项目详情。GitHub 与邮箱为空时不会显示链接。
- `src/content/posts/`：Markdown 文章。文件名形成文章地址。
- `src/pages/index.astro`：首页主标题与布局。
- `src/pages/about.astro`：完整的关于页文案。
- `src/styles/global.css`：颜色变量、字体、间距、响应式布局。
- `public/favicon.svg`：站点图标。

当前个人介绍和三篇文章仍含示例文案；替换真实内容后，把相应 `sample` 设为 `false`。

首页展示三个 `featured: true` 的 GitHub 项目，项目列表同时保留 XlcBlog 本站。项目介绍根据下列仓库的 README 与公开实现手动整理，构建和访问网站均不依赖 GitHub API；仓库功能变化后需更新 `src/data/site.ts`。封面为本站绘制的主题示意，并非产品截图。

- [qlementine](https://github.com/zcy946/qlementine)：面向 Qt5 的现代 QStyle 分支；详情页保留 [oclero/qlementine](https://github.com/oclero/qlementine) 和 Olivier Cléro 的上游署名。
- [QtForge](https://github.com/zcy946/QtForge)：CMake、Qt5 Widgets、C++17 应用脚手架，集成 XlcLogger 与 XlcLogWidget。
- [XLCCircularLoadingIndicator](https://github.com/zcy946/XLCCircularLoadingIndicator)：Qt5 环形加载组件，支持 Dot 与 Moon 样式。

新文章示例：

```md
---
title: '文章标题'
description: '一句话摘要'
date: 2026-10-02
category: '技术'
tags: ['Astro']
draft: true
sample: false
---

这里是正文。

## 一个小节

这里是这一节的内容。
```

`draft: true` 的文章不会出现在首页、文章列表或静态详情页。发布时改为 `false`。发布日期仅用于显示和排序，不提供定时发布。文章目录从二至四级标题自动生成。搜索在浏览器中匹配标题、摘要和标签，不搜索全文。

### 南沙区政府早报

编写或改写网页早报时，先按编辑指南选题、排序，并核对哪些旧事项值得再次提醒，再复制 Markdown 模板。11 月 23 日这期可作对照。[Dot 编辑指南](templates/README.md) · [早报模板](templates/briefing.md) · [11 月 23 日样稿](src/content/posts/nansha-morning-2026-11-23.md)

### HTML 邮件速览

邮件根据当期网页已刊出的事项制作速览。入选事项保留办理条件、受理方式与期限，按单栏版式输出 HTML 正文和纯文本备份。

```sh
npm run email:render -- examples/email/nansha-morning-2026-10-15.json
```

查看 [10/15 邮件样例](examples/email/nansha-morning-2026-10-15.html) 和 [复用说明](templates/email/README.md)。该命令只生成本地文件；邮件发送服务可单独接入。

## 部署到 Cloudflare Pages（当前生产环境）

- 正式地址为 `https://www.xialichen.com`。
- Pages 项目：`xlc-blog`，默认地址：`https://xlc-blog.pages.dev`
- GitHub 仓库：`zcy946/XlcBlog`，生产分支：`main`
- 构建命令：`npm run build`，输出目录：`dist`，根目录为仓库根目录。
- 构建使用 `SITE_URL=https://www.xialichen.com` 和 `NODE_VERSION=24.18.0`。

以上设置位于 Cloudflare Pages 项目配置中。推送到 GitHub 的 `main` 分支会自动构建并发布；本地尚未提交、推送的修改不会上线。可在 Pages 的 Deployments 中检查构建日志及部署状态。

文章由 Astro 静态生成。Cloudflare Pages Functions 只处理评论与站主管理路径。图片放在 `public/`，随网站一起发布。

更换域名时，同时调整 Pages 的 Custom domains、Cloudflare DNS 和构建环境变量 `SITE_URL`，然后重新部署，使 canonical 和 Open Graph URL 使用新域名。

## 部署到自己的服务器（可选）

网站不需要常驻 Node.js 或数据库。服务器只需提供 `dist/` 内的静态文件。

1. 在本地或 CI 设置真实域名并执行构建：

   PowerShell：

   ```powershell
   $env:SITE_URL = 'https://your-domain.example'
   npm run build
   ```

   Linux / CI：

   ```sh
   SITE_URL=https://your-domain.example npm run build
   ```

   未设置 `SITE_URL` 时会省略 canonical 和 Open Graph URL，方便本地预览。`.env.example` 仅用于记录配置示例；构建配置从进程环境变量读取域名。

2. 将 `dist/` 内的内容上传到服务器上的 `/var/www/xlc-blog`，保留目录结构。建议为每次发布建立独立目录，验证后切换网站根目录或符号链接，便于回滚。
3. 修改 `deploy/Caddyfile` 中的域名和根目录，再合并到服务器的 Caddy 配置。不要覆盖服务器上其他网站的配置。
4. 确保域名解析到服务器，允许访问 80 和 443 端口。Caddy 在满足证书签发条件时自动管理 HTTPS。
5. 用 `caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile` 验证后重载 Caddy，再检查首页、文章、项目、静态资源及 404 页面。

`/_astro/` 下带哈希的资源配置了长期缓存，HTML 页面保持可更新。本站使用目录式 URL；部署时应保留目录中的 `index.html`。如沿用 Nginx，应采用类似 `try_files $uri $uri/ =404;` 的静态站配置。

## 设计与行为

- 系统字体，无外部字体、图片或跟踪脚本请求。
- 深浅主题首次跟随系统，手动选择保存在本地浏览器。切换时通过统一的颜色进度在 320 毫秒内渐变，覆盖背景、文字、边框、SVG、阴影、渐变图案和代码高亮；连续点击从当前颜色反向过渡。首屏不播放主题动画，开启减少动态效果时即时切换。`src/styles/global.css` 中每个 `color-mix()` 的前后两个颜色分别为浅色与深色。
- 正文使用 180 毫秒的淡入与轻微上移动画，直接作用于真实内容，期间仍可点击导航、文章和项目；主题背景与导航不参与动画。首屏内联背景样式避免样式资源加载时露出白底；系统设置为减少动态效果时关闭动画。动画样式在 `src/styles/page-transitions.css` 中调整，无需额外脚本。
- 搜索与分类组合筛选，并提供无结果状态、清除按钮和屏幕阅读器结果提示。
- 文章目录收录二至四级标题，子目录默认折叠，支持原生键盘展开和锚点跳转。滚动时标识当前小节；桌面端自动展开所在分支，保留手动开合选择，目录过长时可独立滚动。开合使用 220 毫秒的高度过渡和轻微淡入淡出，支持连续点击反向切换；减少动态效果或浏览器不支持相关 CSS 特性时直接开合。移动端保持手动展开，避免阅读时改变正文位置；禁用 JavaScript 时仍可展开与跳转。
- 禁用 JavaScript 时仍可阅读、导航；搜索和主题按钮隐藏。
- 正文支持 Markdown 引用、列表、表格和代码高亮。
- 提供跳转到正文、可见键盘焦点和减少动态效果支持。

### 访客评论

普通文章与早报在页尾按需加载评论，示例文章仅展示正文。游客可以在同一浏览器撤回自己的留言。「反馈」入口也受人机验证保护。站主通过 `/admin/comments/` 查看待审、反馈、公开和已隐藏的留言。

Cloudflare Pages 的预览和生产环境分别绑定各自的 `COMMENTS_DB`。新库先执行 `deploy/comments/schema.sql`。Pages 环境还需要 `TURNSTILE_SITEKEY`、`TURNSTILE_SECRET`、`COMMENT_RATE_SECRET`、`COMMENT_HOSTS`（当前环境允许提交的主机名）、`ACCESS_ISSUER`、`ACCESS_AUD` 与 `OWNER_EMAIL`。管理页和同路径下的 API 使用只放行站主邮箱的 Cloudflare Access 应用。密钥和邮箱在平台中配置。

独立的定时 Worker 使用 `deploy/comments/digest.js`，绑定同一环境的 `COMMENTS_DB`、仅限已验证站主邮箱的 `MAIL`、`OWNER_EMAIL`、`MAIL_FROM` 和 `ADMIN_URL`。每日任务汇总新增待办，并清理隐藏满 30 天的留言。访客撤回即时删除当前库的原文、回复与关联反馈。

运行 `npm test` 验证评论和邮件逻辑（Node 22.13+ 或 24）。只部署 `dist/` 的静态服务器仍可正常阅读正文，互动功能需要 Pages Functions 与以上绑定。

## 搜索引擎站点地图

每次 `npm run build` 都会通过 Astro 静态端点重新生成 `dist/sitemap.xml`、`dist/robots.txt` 和 `dist/llms.txt`。Cloudflare Pages 使用 `SITE_URL=https://www.xialichen.com`。

- 可在 Google Search Console 的“站点地图”中提交 `https://www.xialichen.com/sitemap.xml`。
- 包含首页、关于、文章及项目列表、项目详情，以及与详情页共用 `getPosts()` 筛选的已发布文章。
- `draft: true` 的文章、404、模板和验证文件不进入站点地图。增加新的独立公开页面时，更新 `src/pages/sitemap.xml.ts` 中的公开路径列表；新增文章及项目自动跟随内容更新。
- 不虚构 `lastmod`：现有内容只有发布日期，没有可靠的最后修改时间，因此暂不输出该字段。
- 未设置 `SITE_URL` 的本地预览生成空站点地图，robots 不声明站点地图，避免混入 localhost 地址。正式部署必须设置正确的 `SITE_URL`。
- 站点地图帮助搜索引擎发现网页，不保证收录或排名；提交由站点所有者在 Search Console 中完成。

构建后可运行 `node scripts/check-sitemap.mjs`，核对生产站点地图与生成的公开 HTML 页面一致，并检查 robots 声明、重复地址及错误页排除。使用其他域名时，运行检查时使用与构建相同的 `SITE_URL`。

配置 `SITE_URL` 后，首页、关于页、归档、项目和正式文章会生成与页面规范地址一致的 JSON-LD。文章可用 `image: '/images/…'` 指定正文中已有的代表图片，供结构化数据和社交分享使用。
