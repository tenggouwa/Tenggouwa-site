# Cloudflare Tunnel 接入

把后端通过 Cloudflare Tunnel 暴露到 `https://api.<你的域名>`，**不开服务器任何入站端口**，
TLS 完全由 Cloudflare 边缘处理。

## 前提

1. 一个域名（不一定贵，新顶级域 `.dev` `.app` 几十块一年；老 `.com` 都行）
2. 域名 DNS 托管到 Cloudflare（免费迁过去，注册商那边改 NS 即可）
3. Cloudflare 账户已经能看到这个域名的 Zone

## 一次性配置

### 1. 在 Cloudflare 建一个 Tunnel

1. 打开 [one.dash.cloudflare.com](https://one.dash.cloudflare.com/)（即 Zero Trust）
2. 左侧 **Networks → Tunnels → Create a tunnel**
3. Connector 选 **Cloudflared**，给个名字比如 `tenggouwa-aliyun`
4. **Save tunnel** 后会到 connector 安装页面，**选 Docker tab**，能看到一条
   `docker run cloudflare/cloudflared:latest tunnel run --token eyJh...` 命令
5. **复制最后那个 `eyJh...` 长串 token**（不是整条命令）—— 这就是
   `CLOUDFLARE_TUNNEL_TOKEN`，贴到服务器 `.env`

### 2. 配置 Tunnel 路由

进入 Tunnel 详情 → **Public Hostnames → Add a public hostname**：

| 字段 | 值 |
|---|---|
| Subdomain | `api` |
| Domain | `<你的域名>` |
| Path | 留空 |
| Service Type | `HTTP` |
| URL | `app:10095`（docker compose 网络里的服务名 + 端口）|

Save。Cloudflare 会自动在你的 zone 加一条 CNAME 记录指向 tunnel UUID。

### 3. 部署后端

```bash
# 本地：
pnpm deploy:server

# 远端首次部署前要做的事：
ssh openclaw
cd ~/apps/Tenggouwa-server
cp .env.prod.sample .env
vim .env            # 填 POSTGRES_DEFAULT_PASSWORD / AUTH_JWT_SECRET / ADMIN_*_PASSWORD_HASH / CLOUDFLARE_TUNNEL_TOKEN
# 之后再回到本地跑 pnpm deploy:server
```

`docker compose up -d --build` 之后，Cloudflared 容器会和 Cloudflare 边缘建立反向连接，
浏览器访问 `https://api.<你的域名>/health/check` 应该返回 `{"status":"UP"}`。

## 排错

```bash
# 服务器
docker compose -f docker-compose.prod.yml logs cloudflared
# 看到 "Registered tunnel connection" 4 条就成功了

# 看 app 是否对 Cloudflared 可达
docker compose -f docker-compose.prod.yml exec cloudflared wget -qO- http://app:10095/health/check
```

如果 Cloudflare 后台显示 Tunnel 状态 `HEALTHY` 但访问 502：检查 ingress 配置里的 service URL
是不是 `app:10095`（注意是服务名，不是 localhost / 127.0.0.1）。

## 安全建议（之后做）

- 在 Cloudflare → Zero Trust → Access 给 `api.<域名>/api/admin/**` 套一层 Access 策略
  （比如限制只能你邮箱 magic link 登录），admin 接口前面再加一层防护
- WAF 规则把奇怪 user-agent 直接 ban
- Rate limit：每 IP/min 限请求数

## 备份方案：买不到域名 / 不想用 Cloudflare

走系统 nginx + certbot（[nginx 模板](nginx/tenggouwa.conf)），打开服务器 80/443 入站。
此时 `docker-compose.prod.yml` 里 cloudflared 服务可以删掉，并给 app 加
`ports: ["127.0.0.1:10095:10095"]` 让宿主机 nginx 反代。
