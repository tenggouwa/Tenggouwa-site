# mail-worker

Cloudflare Email Worker：收 `*@<域名>` 的邮件 → 解析 MIME → 抽验证码 →
HMAC 签名后 POST 给后端 ingest。后端存库，admin 后台「接码」页查看。

> 未配 `MAIL_INGEST_SECRET` / `INGEST_URL` 时自动回退成**只打日志**（`wrangler tail` 看），
> 方便还没配密钥时先观察。
>
> 独立部署，**不在 pnpm workspace 里**（`pnpm-workspace.yaml` 已 `!apps/mail-worker`）。
> 在本目录单独 `npm install` / `wrangler`，不碰 monorepo 的 lockfile 和 CI。

## 一次性配置

```bash
cd apps/mail-worker
npm install
npx wrangler login
```

### 1. 生成 HMAC 密钥并两边配同一个值

```bash
python3 -c "import secrets;print(secrets.token_urlsafe(32))"   # 记下这串
```

- **Worker 侧**：`npx wrangler secret put MAIL_INGEST_SECRET`（粘贴上面那串）。
- **后端侧**：把同一串写进服务器 `apps/server/.env` 的 `MAIL_INGEST_SECRET=`，
  然后 `pnpm deploy:server` 重启后端生效。

`INGEST_URL` 已写在 `wrangler.toml`（`https://api.tenggouwa.com/api/ingest/mail`），
如后端地址不同就改那里。

### 2. 部署 Worker

```bash
npx wrangler deploy      # 部署名：tenggouwa-mail-log
```

### 3. Cloudflare 后台把收信指到 Worker（若还没配过）

- Dashboard → zone → **Email → Email Routing** → 启用（自动加 MX + SPF）。
- **Routing rules → Catch-all → Send to a Worker → `tenggouwa-mail-log`** → 保存。

## 验证

给 `任意名@<域名>` 发一封带验证码的信，然后：

- 后台：admin →「接码」页，填收件箱名（@ 前那段）→「查收件箱」/「等新验证码」。
- 或看 Worker 日志确认投递：`npx wrangler tail`，会打 `[mail] posted ... status=200`。

## 坑

- `status=401`：Worker 和后端的 `MAIL_INGEST_SECRET` 不一致，或后端还没部署新密钥。
- `post-failed`：`INGEST_URL` 不通（后端/Tunnel 挂了或地址错）。
- 解析失败会打 `parse-failed`；某些邮件报缺 Node API 时给 `wrangler.toml` 加
  `compatibility_flags = ["nodejs_compat"]` 再部署。
- Catch-all 会连垃圾/钓鱼邮件一起收 —— 只抽码、不点信里链接。正文上限 32KB。
