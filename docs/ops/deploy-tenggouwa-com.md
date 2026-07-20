# 双域名部署：github.io + tenggouwa.com

## 背景

我们希望两个 URL 都能**独立访问**前端（不是 301 跳转关系）：

- `https://tenggouwa.github.io/Tenggouwa-site/` —— GitHub Pages，子路径
- `https://tenggouwa.com/` —— 根路径

GitHub Pages 一个 repo 只能挂一个域名（custom domain 一旦设置，github.io URL 会强制 301 跳过来），所以 tenggouwa.com 必须走**另一个 host**。

后端只有一个（`api.tenggouwa.com`），两个前端共享同一个 API。

## 一份代码，两套构建

[scripts/build-pages.sh](../../scripts/build-pages.sh) 已经参数化：

| 命令 | `PAGES_TARGET` | base | 产物目录 |
|---|---|---|---|
| `pnpm build:pages` | `ghpages`（默认） | `/Tenggouwa-site/` + admin/agent/casino 子路径 | `pages-dist/` |
| `pnpm build:cf` | `root` | `/` + `/admin/` + `/agent/` + `/casino/` | `cf-dist/` |

两份产物互不影响，可以共存。

## 推荐方案：Cloudflare Pages

DNS 已经在 Cloudflare，接 Cloudflare Pages 最干净。

### 一次性接入

1. **CF dashboard** → Workers & Pages → Create → Pages → **Connect to Git**。
2. 选 `tenggouwa/Tenggouwa-site` 仓库（首次需要授权 Cloudflare GitHub App）。
3. 构建设置：

   | 字段 | 值 |
   |---|---|
   | Production branch | `main` |
   | Framework preset | `None`（不要选 Vite，会被它自动加奇怪的环境变量） |
   | Build command | `corepack enable && pnpm install --frozen-lockfile=false && pnpm build:cf` |
   | Build output directory | `cf-dist` |
   | Root directory | `/`（默认） |

4. **环境变量**（Production + Preview 都加）：

   | Key | Value |
   |---|---|
   | `VITE_API_BASE` | `https://api.tenggouwa.com` |
   | `NODE_VERSION` | `20` |

5. 首次构建跑完后，**Custom domains** → 添加：
   - `tenggouwa.com`
   - `www.tenggouwa.com`（可选）

   CF Pages 会自动写 DNS（CNAME `tenggouwa-site.pages.dev`），SSL 证书自动签发。

### 之后的日常

- push `main` → CF Pages 自动构建 `pnpm build:cf` → 上 `tenggouwa.com`。
- 同一次 push → GitHub Actions 跑 [deploy-pages.yml](../../.github/workflows/deploy-pages.yml) → 上 `tenggouwa.github.io/Tenggouwa-site/`。
- 两边并行，互不阻塞。
- 数据库里的计划发布不会产生 git push；workflow 每 6 小时重建 GitHub Pages，并通过
  `CLOUDFLARE_DEPLOY_HOOK` 触发 Cloudflare Pages 同步重建。

## 备选方案：阿里云 nginx（走 openclaw）

如果不想引入 Cloudflare Pages，也可以把 `cf-dist/` 推到 openclaw 服务器，nginx 当静态目录托管。

1. 本地构建：`pnpm build:cf`。
2. 把 `cf-dist/` 同步到服务器（例如 `/var/www/tenggouwa-site/`）：

   ```bash
   rsync -avz --delete cf-dist/ openclaw:/var/www/tenggouwa-site/
   ```

3. nginx server block 大致：

   ```nginx
   server {
       listen 443 ssl http2;
       server_name tenggouwa.com www.tenggouwa.com;

       root /var/www/tenggouwa-site;
       index index.html;

       # SPA 兜底：root web
       location / {
           try_files $uri $uri/ /index.html;
       }

       # SPA 兜底：admin 子应用
       location /admin/ {
           try_files $uri $uri/ /admin/index.html;
       }

       location /agent/ {
           try_files $uri $uri/ /agent/index.html;
       }

       location /casino/ {
           try_files $uri $uri/ /casino/index.html;
       }

       # ssl_certificate / ssl_certificate_key 走你现有的 CF Tunnel 或 Let's Encrypt
   }
   ```

4. 把 `tenggouwa.com` 的 DNS A 记录指向 openclaw 公网 IP，或者继续走 Cloudflare Tunnel
   （在 `cloudflared` 配置里加 `tenggouwa.com → http://localhost:80`）。

这条路的好处是流量在自己服务器上，坏处是要自己管 SSL / 缓存 / CDN。

## 已经联动改的事

- [apps/server/app/config/config-prod.yml](../../apps/server/app/config/config-prod.yml) —— CORS 白名单已加 `https://tenggouwa.com` 和 `https://www.tenggouwa.com`。改完后端需要重新部署：`pnpm deploy:server`。

## 还需要手动确认的事

- **TOTP cookie 跨站**：[apps/server/app/modules/totp/router.py](../../apps/server/app/modules/totp/router.py) 的 cookie 设置要在改域名时重新实测。
- **SEO 重复内容**：GitHub Pages 构建已经统一加 `noindex`，canonical 根域由预渲染产物指向 `SITE_ORIGIN`。
- **GitHub Pages 不要设 custom domain**：进 repo Settings → Pages，确认 "Custom domain" 一栏是空的。一旦填上 tenggouwa.com，github.io URL 会强制 301 跳走，独立访问就废了。
