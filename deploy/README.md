# 生产部署

当前生产由两条独立链路组成：四个静态 SPA 发布到 Pages；FastAPI + PostgreSQL + cloudflared
以 Docker Compose 部署到阿里云。合并前端代码会自动发布，后端仍需手动执行部署命令。

## 前端：GitHub Pages + Cloudflare Pages

`scripts/build-pages.sh` 构建 web/admin/agent/casino 和 SEO 产物：

```bash
# GitHub Pages 仓库子路径镜像 → pages-dist/，自动 noindex
pnpm build:pages

# tenggouwa.com 根路径构建 → cf-dist/
pnpm build:cf
```

GitHub Actions `deploy-pages.yml` 在相关文件 push `main` 后：

1. 同时构建 `pages-dist` 和 `cf-dist`。
2. 发布 GitHub Pages 镜像。
3. 上传 root artifact，运行 Lighthouse。
4. 发布后通知 IndexNow/Baidu/Google（凭据存在时）。

workflow 每 6 小时重建一次，让数据库中到期发布的文章进入静态 HTML 与 sitemap；定时/手动运行还会
调用 `CLOUDFLARE_DEPLOY_HOOK` 触发 canonical 域名重建。

GitHub Actions variables：

- `VITE_API_BASE=https://api.tenggouwa.com`
- `SITE_ORIGIN=https://tenggouwa.com`
- 可选：`VITE_UMAMI_URL`、`VITE_UMAMI_WEBSITE_ID`、`BAIDU_SITE`

GitHub Actions secrets：

- `CLOUDFLARE_DEPLOY_HOOK`
- 可选：`INDEXNOW_KEY`、`BAIDU_TOKEN`、`GSC_SERVICE_ACCOUNT_JSON`、`LHCI_GITHUB_APP_TOKEN`
- nightly Agent eval：`KB_LLM_API_KEY`

双域名和 Cloudflare Pages 设置见 [docs/ops/deploy-tenggouwa-com.md](../docs/ops/deploy-tenggouwa-com.md)。

## 后端：Docker Compose + Cloudflare Tunnel

生产栈：

```text
cloudflared ── Docker network ──> app:10095 ──> postgres:5432
                                      │
                                      └── agent_ws volume
```

宿主机只把 PostgreSQL 绑定到 `127.0.0.1:5432`，app 端口不发布；公网 API 由 Cloudflare Tunnel
转发到 `app:10095`。cloudflared 固定 HTTP/2 transport，避免当前网络下 QUIC 长连接不稳。

### 一次性准备

服务器需要 Docker Engine、Compose plugin 和可用的 Cloudflare Tunnel token：

```bash
ssh openclaw
mkdir -p ~/apps/Tenggouwa-server
cd ~/apps/Tenggouwa-server
```

首次可先从本地执行一次部署，让脚本创建目录并同步模板：

```bash
pnpm deploy:server
```

它会因为远端没有 `.env` 明确失败。然后在服务器上：

```bash
cd ~/apps/Tenggouwa-server
cp .env.prod.sample .env
chmod 600 .env
# 编辑并填入真实 secret
```

至少配置：数据库密码、JWT、admin bcrypt hash、Tunnel token、Pi token、LLM key；需要语义检索时
配置 embedding key，需要 Pi 执行/MCP/SEO 时再开启对应可选项。完整字段见 `.env.prod.sample`。

回到本地再次执行：

```bash
pnpm deploy:server
```

### 日常发布

```bash
pnpm deploy:server
```

脚本会：

1. `rsync --delete` 同步 `apps/server`，但保留远端 `.env` 和运行目录。
2. 保存当前 `latest` 为 `rollback`。
3. 使用 BuildKit 执行 Compose build/up；entrypoint 自动运行 Alembic。
4. 最多等待 120 秒 health check。
5. 成功后给镜像打 `tenggouwa-server:<git-sha>` tag；失败时打印 app 日志和回滚命令。

### 运维命令

```bash
ssh openclaw 'cd ~/apps/Tenggouwa-server && docker compose -f docker-compose.prod.yml ps'
ssh openclaw 'cd ~/apps/Tenggouwa-server && docker compose -f docker-compose.prod.yml logs -f app'
ssh openclaw 'cd ~/apps/Tenggouwa-server && docker compose -f docker-compose.prod.yml logs -f cloudflared'
```

不要在不确认备份的情况下运行 `docker compose down -v`，它会删除 PostgreSQL 和 Agent workspace volume。

## 数据备份

需要备份：

- PostgreSQL `pg_data`：使用 `pg_dump` 生成逻辑备份并复制到宿主机/异地存储。
- Agent workspace `agent_ws`：只有需要保留沙箱工作产物时备份。
- 远端 `.env`：以安全渠道保存，不进入 Git。

`deploy/postgres.md` 描述旧的宿主机 PostgreSQL/systemd 方案，仅作为 legacy 参考；当前生产以
`docker-compose.prod.yml` 为准。

## 相关文档

- [Cloudflare Tunnel](cloudflare-tunnel.md)
- [双域名/Cloudflare Pages](../docs/ops/deploy-tenggouwa-com.md)
- [当前系统架构](../docs/architecture.md)
- [后端说明](../apps/server/README.md)
