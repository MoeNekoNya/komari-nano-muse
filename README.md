# NanoMuse · CF Server Monitor 主题

将 NanoMuse 的观测站视觉迁移为 **CF-Server-Monitor（Cloudflare Workers + D1）第三方主题**。项目使用 Vue 3 + Vite + Vue Router Hash 路由，首页为 `/#/`，服务器详情为 `/#/server/:id`。

## 数据与额度保护

主题只使用 CFSM 第三方主题公开接口：

- `GET /api/config`：每个 API Base 首次读取一次，并在页面内缓存。
- `GET /api/servers`：每个 API Base 仅在首页首次加载时请求一次。
- `GET /api/server?id=:id`：详情页初始数据；页面恢复可见时补充一次当前详情。
- `GET /api/history/all?id=:id&hours=:hours`：默认 `0.167`（10 分钟），只在首次进入详情或用户切换范围时请求。
- `GET /api/ws?subscribe=all`：首页连接后发送当前 Worker 的 ID 列表；详情页使用 `subscribe=:id`。
- `POST /api/theme_options`：只保存主题个性化配置。

没有 REST 轮询、没有 Komari API 回退、没有管理端 API。首页 WS 更新会在内存中合并增量样本，每秒最多刷新一次。页面隐藏时关闭 WS；首页恢复时复用已缓存列表和 ID，不重复请求 `/api/servers`；详情页恢复时先补充 `/api/server` 再重连。

> Turnstile 协议说明：首次读取 `/api/config` 获取 Site Key 后，完成验证需要再携带一次性 token 请求 `/api/config`，以交换服务端的 `turnstile_verified`。该请求只发生于首次验证或凭证被服务端拒绝后，不是轮询。

## 开发

需要 Node.js 20+。

```bash
npm install
npm run dev
npm run build
```

本地开发时可在 `index.html` 的 meta 标签中设置 API Base，或通过环境变量 `API_BASE` 注入。Worker 必须允许开发站点的跨域 origin。

## GitHub Pages 自动构建

仓库内的 `.github/workflows/build-pages.yml` 在推送 `main` / `master` 或手动触发时构建，并把纯静态产物追加提交到 `dist` 分支。每次构建提交信息取触发构建的源码 commit subject，不会 force push。

站点标题、深浅色（preferred_theme）、语言（default_language）和 theme_options 从 `/api/config` 读取。注意：当前 CFSM 的公开 `/api/config` 响应不包含 `custom_bg`、`favicon`、`custom_head`、`custom_script`；Worker 自己托管主题时会在 HTML 层自动注入这些外观设置，纯 GitHub Pages 静态页面不能通过允许的公开 API 读取它们。静态 Pages 的背景可用 `BACKGROUND_IMAGE` Secret 提供后备值。主题不会调用管理端 API。\n\n在仓库 **Settings → Secrets and variables → Actions** 中配置以下 Secrets：

| Secret | 用途 |
|---|---|
| `API_BASE` | 一个或多个 Worker origin，英文逗号分隔 |
| `TITLE` | 静态页面标题后备值 |
| `BACKGROUND_IMAGE` | 静态页面背景图后备值 |
| `CSP_API` | 追加到 CSP `connect-src` 的 origin / source |
| `CSP_STATIC` | 追加到 CSP 图片、字体等静态资源指令的 source |

然后在 **Settings → Pages** 中选择 `Deploy from a branch`，分支选 `dist`、目录选 `/ (root)`。同时确保 **Settings → Actions → General → Workflow permissions** 允许 Actions 写入仓库内容（`contents: write`）。工作流已经声明 `permissions: contents: write`。

## 跨域部署

如果主题托管在 GitHub Pages、Worker 则使用其他域名，必须在**每个** Worker 的环境变量中配置 `CORS_ALLOWED_ORIGINS`。填写纯 origin（不含路径、查询参数和末尾斜杠），多个 origin 用英文逗号分隔。例如：

```text
https://your-name.github.io,https://monitor.example.com
```

多 API Base 模式下，每个 Worker 只接收属于它自己的服务器 ID；私有站点的跨域 WebSocket 会在 URL 上附加 JWT token，请仅使用 HTTPS。

## 部署产物

Vite 输出目录 `dist/` 中仅有 `index.html` 与 `assets/`。旗帜和系统图标继续使用 CFSM 默认皮肤的 `/flags/<code>.svg`、`/os-icons/<filename>` 路径。
