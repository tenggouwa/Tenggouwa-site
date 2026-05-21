# 部署模板

## GitHub Pages（前端）

`.github/workflows/deploy-pages.yml` 自动跑：

1. 安装 pnpm 依赖
2. 跑 `scripts/build-pages.sh` 构建 web + admin 到 `pages-dist/`
3. 通过 `actions/deploy-pages` 发布

仓库设置：

- Settings → Pages → Source 选 `GitHub Actions`
- Settings → Secrets and variables → Actions → **Variables** 加 `VITE_API_BASE = https://api.<你的域名>`
- 首次部署后访问：`https://<user>.github.io/<repo>/`

## 阿里云服务器（后端，全 Docker + Cloudflare Tunnel）

主路径：**Docker compose（[apps/server/docker-compose.prod.yml](../apps/server/docker-compose.prod.yml)）+ Cloudflare Tunnel**。

- 容器：`postgres` / `app`（FastAPI）/ `cloudflared`（Tunnel connector）
- 服务器不开任何入站端口；TLS 在 Cloudflare 边缘
- 详细步骤见 [cloudflare-tunnel.md](cloudflare-tunnel.md)
- 数据库运维见 [postgres.md](postgres.md)（备份、排错都通用）

### 一次性准备

```bash
ssh openclaw

# 1) 装 docker + compose
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER   # 注销重登让 group 生效

# 2) 在 Cloudflare 建 Tunnel，复制 token（见 cloudflare-tunnel.md）

# 3) 准备目录（首次 pnpm deploy:server 会自动 mkdir，但要先放好 .env）
mkdir -p ~/apps/Tenggouwa-server
```

### 首次部署

```bash
# 本地（首次会因为远端没 .env 而失败）
pnpm deploy:server

# 服务器上一次性准备 .env
ssh openclaw
cd ~/apps/Tenggouwa-server
cp .env.prod.sample .env
vim .env   # 填 4 个 secret:
           #   POSTGRES_DEFAULT_PASSWORD
           #   AUTH_JWT_SECRET
           #   ADMIN_TENGGOUWA_PASSWORD_HASH
           #   CLOUDFLARE_TUNNEL_TOKEN

# 本地再跑一次
pnpm deploy:server   # 这次会 build 镜像并起容器
```

### 日常发布

```bash
pnpm deploy:server   # rsync → docker compose up -d --build
```

数据库迁移自动在容器启动时跑（`entrypoint.sh` 里 `alembic upgrade head`）。

## 备份路径

### 不用 Cloudflare Tunnel（要开 80/443 入站）

- 删 `docker-compose.prod.yml` 里的 cloudflared 服务
- 给 app 加 `ports: ["127.0.0.1:10095:10095"]`
- 宿主机装 nginx + certbot，套 [nginx/tenggouwa.conf](nginx/tenggouwa.conf) 反代到 `127.0.0.1:10095`

### 不用 Docker，走 systemd

[systemd/tenggouwa-server.service](systemd/tenggouwa-server.service) 是之前写的 systemd user unit 模板，
直接 `apt install postgresql` + uv 跑 app。维护成本更低但跨机迁移麻烦，不再是主推方案。
