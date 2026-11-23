# NanoMuse · CF Server Monitor 第三方主题

NanoMuse 是为 **CF-Server-Monitor（Cloudflare Workers + D1）** 改造的第三方主题，保留原 NanoMuse 的视觉风格，并使用 CFSM 官方公开 API、WebSocket 与主题配置接口。

## 在 CFSM 后台使用（不需要 API_BASE）

本项目面向 CFSM 的「后台提交主题地址」模式。CFSM Worker 会从 GitHub 拉取主题的 `index.html`，并反代 `/assets/` 静态资源；浏览器访问的页面仍然位于你的 Worker 域名下，因此主题默认以 `window.location.origin` 作为 API Base。

**不需要配置以下内容：**

- 不需要 GitHub Pages。
- 不需要在主题仓库 Secrets 中填写 Worker 地址或 `API_BASE`。
- 不需要为了主题单独设置 `CORS_ALLOWED_ORIGINS`。
- 不需要在后台单独填写 CSS、JS 或资源地址。

### 后台主题地址

最新构建分支为 `dist`。在 CFSM 后台的外观 / 主题设置中，将下面的地址作为主题地址提交：

```text
https://github.com/MoeNekoNya/komari-nano-muse/tree/dist
```

也可以锁定到某次构建的不可变 Commit 地址：

```text
https://github.com/MoeNekoNya/komari-nano-muse/tree/<dist-commit-sha>
```

分支地址会跟随后续 `dist` 更新；Commit 地址固定在对应版本。Worker 对分支主题资源使用短期缓存，对 Commit 资源使用不可变缓存。

## 数据接口与 D1 额度保护

主题只调用 CFSM 第三方主题公开接口：

- `GET /api/config`：每个 Worker 首次载入时获取一次，内存缓存。
- `GET /api/servers`：首页首次进入时获取一次；实时数值通过 WebSocket 更新。
- `GET /api/server?id=:id`：获取单台服务器详情。
- `GET /api/history/all?id=:id&hours=:hours`：默认 `0.167`（10 分钟），用户切换时间范围时才再次请求。
- `GET /api/ws?subscribe=all`：首页按该 Worker 的服务器 ID 订阅。
- `GET /api/ws?subscribe=:id`：详情页只订阅当前服务器。
- `POST /api/theme_options`：保存主题自己的配置。

没有 REST 轮询、没有 Komari API 回退、没有管理端 API。首页 WS 更新在内存中合并增量样本，每秒最多刷新一次。页面隐藏时关闭 WS；首页恢复时复用缓存的服务器列表和 ID，不重复请求 `/api/servers`；详情页恢复时补一次当前详情再重连。

Turnstile 首次验证会按 CFSM 协议使用一次性 token，并缓存服务端返回的 `turnstile_verified`。这不是周期性请求。

## 仓库结构与自动构建

`main` 是源码分支，`dist` 是供 CFSM Worker 读取的主题产物分支。每次向 `main` / `master` 推送或手动触发 Actions，都会：

1. 安装 Vue 3 / Vite 构建依赖。
2. 构建静态主题。
3. 校验产物根目录只有 `index.html` 和 `assets/`。
4. 追加提交到 `dist`，提交说明保留触发本次构建的源码 commit 说明。
5. 不使用 force push，完整保留每次构建历史。

**无需配置 Actions Secrets，也无需启用 GitHub Pages。** Worker 会在托管主题时注入当前站点的外观设置和同源运行环境。

## 外观设置与资源路径

站点标题、favicon、背景图、自定义 head/script、CSP、深浅色和语言由 CFSM 后台外观设置及 Worker 注入机制控制；主题不会把这些站点级配置写死，也不会把它们写进 `theme_options`。

CFSM Worker 会将主题 HTML 中的相对 `assets/` 路径规范化为 `/assets/`，并代理该主题的构建资源。旗帜和 OS 图标使用默认皮肤静态目录：

- 旗帜：`/flags/<code>.svg`
- OS 图标：`/os-icons/<filename>`

## 本地开发与独立静态部署

开发：

```bash
npm install
npm run dev
npm run build
```

如需把它**独立部署到 GitHub Pages 或其他静态主机**（不是 CFSM 后台主题地址模式），才需要设置 `API_BASE` 或 HTML meta `apiBase`，并为 Worker 配置 `CORS_ALLOWED_ORIGINS`。在 CFSM 后台提交主题地址时不要做这一步。

## 跨域补充

只有主题页面和 Worker 不同源时，才需要在每个 Worker 的环境变量 `CORS_ALLOWED_ORIGINS` 中添加主题页面的纯 origin，多个 origin 用英文逗号分隔。通过 CFSM Worker 反代托管本主题时，页面和 API 同源，不需要额外配置。

## 官方文档

- [CFSM 第三方主题开发文档](https://github.com/huilang-me/CF-Server-Monitor/blob/main/theme-develop.md)
- [CFSM 第三方主题商店说明](https://github.com/huilang-me/CFSM-Theme-Store)
